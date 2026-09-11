// Opportunistic scheduler tick (docs/match-results-consensus.md §5, §11.2).
//
// A serverless deploy has no resident process, so if nobody runs
// scripts/ticker.ts the only guaranteed driver is the daily Vercel cron. This
// module lets ordinary traffic stand in for the ticker: the dashboard layout
// calls maybeTick() on every render, and at most once a minute per instance
// it runs the same runTick() the /api/cron/tick route uses -- after the
// response, via @vercel/functions' waitUntil (a no-op outside Vercel, where
// the promise just keeps running in the long-lived Node process).
//
// Guarantees: never delays the render (the DB check and the tick are both
// detached), never throws (every failure is swallowed and logged), and never
// runs when the service-role key is missing (createAdminClient throws inside
// the detached work, not in the page).
import { waitUntil } from '@vercel/functions'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SchedulerState } from '@/types/database'
import { runTick } from './tick'

const MIN_INTERVAL_MS = 60_000

// Module-level: survives across requests inside one warm serverless instance
// (or the whole process in `next start` / `next dev`). Each cold instance
// starts at 0, which is why the DB guard below exists too.
let lastTickAt = 0
let inFlight = false

async function tickIfStale(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const supabase = createAdminClient()
    // Cheap cross-instance guard: claim_due_jobs stamps scheduler_state.last_tick_at
    // on every call (even with nothing due), so if any driver (ticker, cron,
    // another instance) ticked in the last minute, skip this pass. If the row or
    // table can't be read, fall through and tick anyway.
    let lastTick = 0
    try {
      const { data: state } = await supabase
        .from('scheduler_state')
        .select('last_tick_at')
        .eq('id', 1)
        .maybeSingle() as { data: Pick<SchedulerState, 'last_tick_at'> | null }
      lastTick = state?.last_tick_at ? new Date(state.last_tick_at).getTime() : 0
    } catch {
      lastTick = 0
    }
    if (Date.now() - lastTick < MIN_INTERVAL_MS) {
      lastTickAt = Date.now()
      return
    }

    lastTickAt = Date.now()
    await runTick()
  } catch (error) {
    // Includes "relation scheduled_jobs does not exist" before 00018 is
    // applied and a missing SUPABASE_SERVICE_ROLE_KEY: log once, move on.
    console.error('Opportunistic scheduler tick failed:', error)
  } finally {
    inFlight = false
  }
}

export function maybeTick(): void {
  if (Date.now() - lastTickAt < MIN_INTERVAL_MS) return
  try {
    waitUntil(tickIfStale())
  } catch (error) {
    console.error('Could not schedule opportunistic tick:', error)
  }
}
