// The pg_cron driver's side of the scheduler (migration 00036), as returned by
// public.get_ticker_status() and shown in the authorized /api/health details.

/** public.get_ticker_status() (00036). Never carries secret values. */
export interface TickerStatus {
  job: { name: string; schedule: string; active: boolean; command: string } | null
  secrets: { app_url: boolean; cron_secret: boolean }
  last_run: { status: string; start_time: string; end_time: string | null; message: string | null } | null
  last_response: { status_code: number | null; timed_out: boolean | null; error: string | null; created: string } | null
}

/** Why the pg_cron driver is not ticking, from its status. Empty when it looks fine. */
export function driverProblems(driver: TickerStatus | null): string[] {
  if (!driver) return []
  const problems: string[] = []
  if (!driver.job) problems.push('pg_cron job fulbot-tick is missing (migration 00036)')
  else if (!driver.job.active) problems.push('pg_cron job fulbot-tick is inactive')
  const missing = [
    driver.secrets.app_url ? null : 'fulbot_app_url',
    driver.secrets.cron_secret ? null : 'fulbot_cron_secret',
  ].filter(Boolean)
  if (missing.length > 0) problems.push(`Vault secret(s) ${missing.join(', ')} missing: the pg_cron tick does nothing`)
  if (driver.last_run && driver.last_run.status === 'failed') {
    problems.push(`last pg_cron run failed: ${driver.last_run.message ?? 'no message'}`)
  }
  const response = driver.last_response
  if (missing.length === 0 && response) {
    const code = response.status_code
    if (response.timed_out) problems.push('last tick request timed out')
    else if (response.error) problems.push(`last tick request failed: ${response.error}`)
    else if (code === 401) problems.push('last tick request got HTTP 401: fulbot_cron_secret does not match CRON_SECRET')
    else if (code !== null && code >= 300 && code < 400) problems.push(`last tick request got HTTP ${code}: fulbot_app_url redirects, store the final URL`)
    else if (code !== null && code !== 200) problems.push(`last tick request got HTTP ${code}`)
  }
  return problems
}
