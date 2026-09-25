// Crowd-sourced results scheduler (docs/match-results-consensus.md §5, §11.2).
//
// The job queue lives in Postgres (`scheduled_jobs`, migration 00018): every
// timed step of a match -- auto_finish, results_request, results_reminder,
// results_window_close -- is a row with a `run_at`. This module is the only
// consumer: it claims due rows (`claim_due_jobs`, FOR UPDATE SKIP LOCKED), runs
// each one (`run_scheduled_job`, which never raises and records done/failed
// itself), then drains the WhatsApp outbox so anything the handlers emitted
// goes out in the same pass.
//
// It is deliberately idempotent and cheap when nothing is due, so it can be
// called from anywhere and as often as you like: the ticker script, the daily
// Vercel cron, or opportunistically from page renders (see opportunistic-tick.ts).
import { emitPendingMatchCreatedNotifications } from './match-created'
import { emitMatchReminders } from './reminders'
import { drainPushOutbox } from './push'
import { createAdminClient } from '@/lib/supabase/admin'
import { drainOutbox, type DrainOutboxResult } from './dispatch'

const CLAIM_BATCH = 20
// Hard cap per pass so a pathological backlog can't pin a serverless function
// past its timeout; the next tick picks up the rest.
const MAX_BATCHES_PER_TICK = 10

export interface TickJobResult {
  id: string
  job_type: string
  match_id: string | null
  ok: boolean
  error: string | null
}

export interface TickResult {
  claimed: number
  done: number
  failed: number
  jobs: TickJobResult[]
  outbox: DrainOutboxResult | { error: string }
  sweeps: { recurringError?: string; remindersError?: string }
  push: Awaited<ReturnType<typeof drainPushOutbox>> | { error: string }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Error desconocido'
}

export async function runTick(): Promise<TickResult> {
  const supabase = createAdminClient()
  const sweeps: TickResult['sweeps'] = {}
  // The minute ticker must open recurring signups and emit reminders even
  // when nobody has the app open. The daily cron is only a fallback.
  try {
    const { error } = await supabase.rpc('generate_recurring_matches', {})
    if (error) throw new Error(error.message)
    await emitPendingMatchCreatedNotifications(supabase)
  } catch (error) { sweeps.recurringError = errorMessage(error) }
  try { await emitMatchReminders(supabase) }
  catch (error) { sweeps.remindersError = errorMessage(error) }
  const jobs: TickJobResult[] = []
  let claimed = 0
  let done = 0
  let failed = 0

  for (let batch = 0; batch < MAX_BATCHES_PER_TICK; batch++) {
    const { data: rows, error: claimError } = await supabase.rpc('claim_due_jobs', {
      p_limit: CLAIM_BATCH,
    })
    if (claimError) {
      throw new Error(`No se pudieron reclamar trabajos programados: ${claimError.message}`)
    }
    if (!rows || rows.length === 0) break

    claimed += rows.length

    for (const row of rows) {
      const { data, error: runError } = await supabase.rpc('run_scheduled_job', {
        p_job_id: row.id,
      })
      // run_scheduled_job never raises by contract; a transport/RPC error here
      // leaves the row `running` and the 10-minute stale-lock rule in
      // claim_due_jobs re-claims it on a later tick.
      const result = (data ?? {}) as { ok?: boolean; error?: string | null }
      const ok = !runError && result.ok !== false
      const error = runError ? runError.message : (result.error ?? null)
      if (ok) done++
      else failed++
      jobs.push({ id: row.id, job_type: row.job_type, match_id: row.match_id, ok, error })
    }

    if (rows.length < CLAIM_BATCH) break
  }

  // A slow legacy bridge must not hold up device alerts.
  const [outboxResult, pushResult] = await Promise.allSettled([drainOutbox(), drainPushOutbox()])
  const outbox: TickResult['outbox'] = outboxResult.status === 'fulfilled'
    ? outboxResult.value : { error: errorMessage(outboxResult.reason) }
  const push: TickResult['push'] = pushResult.status === 'fulfilled'
    ? pushResult.value : { error: errorMessage(pushResult.reason) }
  return { claimed, done, failed, jobs, outbox, push, sweeps }
}
