// Scheduler health (PLAT-7, docs/deploy.md "Monitoring"). Point an uptime
// monitor at GET /api/health: 200 {"status":"ok"} or 503 {"status":"degraded"}.
//
// Degraded means one of:
//   - no tick for HEALTH_MAX_TICK_AGE_MINUTES (default 10): the ticker is
//     down and results requests, reminders and push wait for the daily cron;
//   - a pending job is overdue by more than OVERDUE_GRACE_MINUTES;
//   - a scheduled job failed in the last 24 h;
//   - the database could not be read.
//
// Anonymous callers get only the status. With `Authorization: Bearer
// $CRON_SECRET` the response also carries the numbers and the recent failures.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ScheduledJob } from '@/types/database'

export const dynamic = 'force-dynamic'

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
  problems: string[]
}

async function collect(): Promise<HealthDetails> {
  const supabase = createAdminClient()
  const now = Date.now()
  const maxAge = maxTickAgeMinutes()
  const overdueCutoff = new Date(now - OVERDUE_GRACE_MINUTES * 60_000).toISOString()
  const failureCutoff = new Date(now - FAILURE_WINDOW_HOURS * 3_600_000).toISOString()

  const [stateResult, overdueResult, failedResult] = await Promise.all([
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
  ])

  const problems: string[] = []
  for (const result of [stateResult, overdueResult, failedResult]) {
    if (result.error) problems.push(`database: ${result.error.message}`)
  }

  const lastTickAt = stateResult.data?.last_tick_at ?? null
  const ageSeconds = lastTickAt ? Math.max(0, Math.round((now - new Date(lastTickAt).getTime()) / 1000)) : null
  if (ageSeconds === null) problems.push('scheduler has never ticked')
  else if (ageSeconds > maxAge * 60) problems.push(`no tick for ${Math.round(ageSeconds / 60)} min`)

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
