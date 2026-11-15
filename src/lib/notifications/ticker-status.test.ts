import assert from 'node:assert/strict'
import test from 'node:test'
import { driverProblems, type TickerStatus } from './ticker-status'

const healthy: TickerStatus = {
  job: { name: 'fulbot-tick', schedule: '* * * * *', active: true, command: 'SELECT public.fulbot_cron_tick()' },
  secrets: { app_url: true, cron_secret: true },
  last_run: { status: 'succeeded', start_time: '2026-11-15T21:00:00Z', end_time: '2026-11-15T21:00:00Z', message: '1 row' },
  last_response: { status_code: 200, timed_out: false, error: null, created: '2026-11-15T21:00:01Z' },
}

test('a configured, answering driver has no problems; no status means no hints', () => {
  assert.deepEqual(driverProblems(healthy), [])
  assert.deepEqual(driverProblems(null), [])
})

test('missing or inactive job', () => {
  assert.deepEqual(driverProblems({ ...healthy, job: null }), ['pg_cron job fulbot-tick is missing (migration 00036)'])
  assert.deepEqual(driverProblems({ ...healthy, job: { ...healthy.job!, active: false } }), ['pg_cron job fulbot-tick is inactive'])
})

test('missing Vault secrets are named, and an old response is not blamed', () => {
  const problems = driverProblems({
    ...healthy,
    secrets: { app_url: true, cron_secret: false },
    last_response: { ...healthy.last_response!, status_code: 401 },
  })
  assert.deepEqual(problems, ['Vault secret(s) fulbot_cron_secret missing: the pg_cron tick does nothing'])
  assert.match(driverProblems({ ...healthy, secrets: { app_url: false, cron_secret: false } })[0], /fulbot_app_url, fulbot_cron_secret/)
})

test('HTTP answers point at the likely misconfiguration', () => {
  const withResponse = (r: Partial<NonNullable<TickerStatus['last_response']>>) =>
    driverProblems({ ...healthy, last_response: { ...healthy.last_response!, ...r } })
  assert.match(withResponse({ status_code: 401 })[0], /does not match CRON_SECRET/)
  assert.match(withResponse({ status_code: 308 })[0], /redirects/)
  assert.match(withResponse({ status_code: 500 })[0], /HTTP 500/)
  assert.match(withResponse({ status_code: null, timed_out: true })[0], /timed out/)
  assert.match(withResponse({ status_code: null, error: "Couldn't resolve host name" })[0], /resolve host/)
})

test('a failed pg_cron run is reported with its message', () => {
  const problems = driverProblems({ ...healthy, last_run: { ...healthy.last_run!, status: 'failed', message: 'permission denied' } })
  assert.deepEqual(problems, ['last pg_cron run failed: permission denied'])
})
