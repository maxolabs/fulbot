// Scheduler health (PLAT-7, docs/deploy.md "Monitoring"). Point an uptime
// monitor at GET /api/health: 200 {"status":"ok"} or 503 {"status":"degraded"}.
//
// Degraded means one of:
//   - no tick for HEALTH_MAX_TICK_AGE_MINUTES (default 10): the pg_cron
//     driver (migration 00036) stopped calling /api/cron/tick, so result
//     requests, reminders and push wait for the daily cron;
//   - a pending job is overdue by more than OVERDUE_GRACE_MINUTES;
//   - a scheduled job failed for good in the last 24 h;
//   - the database could not be read.
// On the documented production setup the pg_cron job ticks every minute, so
// the status is "ok" whenever the scheduler works.
//
// Anonymous callers get only the status. With `Authorization: Bearer
// $CRON_SECRET` the response also carries the numbers, the recent failures
// and the driver's side (get_ticker_status: the pg_cron job, whether the
// Vault secrets exist, its last run and HTTP response). When the tick is
// stale, `problems` says which of those looks wrong.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { driverProblems, type TickerStatus } from '@/lib/notifications/ticker-status'
import type { ScheduledJob } from '@/types/database'

export const dynamic = 'force-dynamic'
// Next 14 serves GET fetches from its Data Cache in a route handler that only
// exports GET, even a force-dynamic one, and supabase-js reads are GET
// fetches: the constant scheduler_state query would return its first answer
// forever and the check would go degraded 10 minutes after each deploy.
export const fetchCache = 'force-no-store'

const DEFAULT_MAX_TICK_AGE_MINUTES = 10
const OVERDUE_GRACE_MINUTES = 10
const FAILURE_WINDOW_HOURS = 24

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`
}

function maxTickAgeMinutes(): number {
  const raw = Number(process.env.HEALTH_MAX_TICK_AGE_MINUTES)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_TICK_AGE_MINUTES
}

type RecentFailure = Pick<ScheduledJob, 'id' | 'job_type' | 'match_id' | 'last_error' | 'updated_at'>

interface HealthDetails {
  last_tick_at: string | null
  last_tick_age_seconds: number | null
  max_tick_age_minutes: number
  overdue_jobs: number
  failed_jobs_24h: number
  recent_failures: RecentFailure[]
  driver: TickerStatus | null
  problems: string[]
}

async function collect(): Promise<HealthDetails> {
  const supabase = createAdminClient()
  const now = Date.now()
  const maxAge = maxTickAgeMinutes()
  const overdueCutoff = new Date(now - OVERDUE_GRACE_MINUTES * 60_000).toISOString()
  const failureCutoff = new Date(now - FAILURE_WINDOW_HOURS * 3_600_000).toISOString()

  const [stateResult, overdueResult, failedResult, driverResult] = await Promise.all([
    supabase.from('scheduler_state').select('last_tick_at').eq('id', 1).maybeSingle(),
    supabase
      .from('scheduled_jobs')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'running'])
      .lt('run_at', overdueCutoff),
    supabase
      .from('scheduled_jobs')
      .select('id, job_type, match_id, last_error, updated_at', { count: 'exact' })
      .eq('status', 'failed')
      .gte('updated_at', failureCutoff)
      .order('updated_at', { ascending: false })
      .limit(10),
    supabase.rpc('get_ticker_status'),
  ])

  const problems: string[] = []
  for (const result of [stateResult, overdueResult, failedResult]) {
    if (result.error) problems.push(`database: ${result.error.message}`)
  }
  // Diagnostics only: a database without 00036 still reports on the ticks.
  const driver = driverResult.error ? null : ((driverResult.data ?? null) as TickerStatus | null)

  const lastTickAt = stateResult.data?.last_tick_at ?? null
  const ageSeconds = lastTickAt ? Math.max(0, Math.round((now - new Date(lastTickAt).getTime()) / 1000)) : null
  const stale = ageSeconds === null || ageSeconds > maxAge * 60
  if (ageSeconds === null) problems.push('scheduler has never ticked')
  else if (stale) problems.push(`no tick for ${Math.round(ageSeconds / 60)} min`)
  if (stale) problems.push(...driverProblems(driver))

  const overdue = overdueResult.count ?? 0
  if (overdue > 0) problems.push(`${overdue} overdue job(s)`)
  const failed = failedResult.count ?? 0
  if (failed > 0) problems.push(`${failed} failed job(s) in the last ${FAILURE_WINDOW_HOURS} h`)

  return {
    last_tick_at: lastTickAt,
    last_tick_age_seconds: ageSeconds,
    max_tick_age_minutes: maxAge,
    overdue_jobs: overdue,
    failed_jobs_24h: failed,
    recent_failures: failedResult.data ?? [],
    driver,
    problems,
  }
}

export async function GET(request: NextRequest) {
  const authorized = isAuthorized(request)
  let details: HealthDetails | null = null
  let failure: string | null = null
  try {
    details = await collect()
  } catch (error) {
    // Missing SUPABASE_SERVICE_ROLE_KEY, network down, table missing.
    failure = error instanceof Error ? error.message : 'unknown error'
    console.error('Health check failed:', error)
  }

  const ok = details !== null && details.problems.length === 0
  const body = authorized
    ? { status: ok ? 'ok' : 'degraded', checked_at: new Date().toISOString(), ...(details ?? { problems: [failure] }) }
    : { status: ok ? 'ok' : 'degraded' }

  return NextResponse.json(body, {
    status: ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}
