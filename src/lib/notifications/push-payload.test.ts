import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPushPayload, isAllowedPushEndpoint, type PushEvent } from './push-payload'

const event: PushEvent = {
  notification_id: 'notification-1', type: 'match_created',
  payload: { date_time: '2026-09-21T23:00:00Z' },
  match_id: 'match-1', group_slug: 'lunes', group_name: 'Fútbol del lunes',
  timezone: 'America/Argentina/Buenos_Aires', language: 'es',
}

test('signup alert identifies the group and local match time and opens signup', () => {
  const payload = buildPushPayload(event)
  assert.equal(payload.title, 'Se abrió la lista')
  assert.match(payload.body, /Fútbol del lunes/)
  assert.match(payload.body, /20:00/)
  assert.match(payload.body, /anotarte/)
  assert.equal(payload.url, '/groups/lunes/matches/match-1')
})

test('teams and result requests deep-link to the relevant screen', () => {
  assert.equal(buildPushPayload({ ...event, type: 'teams_created' }).url, '/groups/lunes/matches/match-1/teams')
  assert.equal(buildPushPayload({ ...event, type: 'results_reminder' }).url, '/groups/lunes/matches/match-1#reportar')
  assert.equal(buildPushPayload({ ...event, language: 'en' }).title, 'Signups are open')
})

test('invalid dates/timezones cannot break delivery; retries use a stable tag', () => {
  assert.doesNotThrow(() => buildPushPayload({ ...event, timezone: 'bad/timezone' }))
  assert.doesNotThrow(() => buildPushPayload({ ...event, payload: { date_time: 'nope' } }))
  assert.equal(buildPushPayload(event).tag, buildPushPayload(event).tag)
})

test('only HTTPS browser push services are accepted as outbound targets', () => {
  for (const endpoint of ['https://fcm.googleapis.com/fcm/send/test', 'https://updates.push.services.mozilla.com/wpush/v2/test', 'https://web.push.apple.com/test']) {
    assert.equal(isAllowedPushEndpoint(endpoint), true, endpoint)
  }
  for (const endpoint of ['http://fcm.googleapis.com/test', 'https://localhost/test', 'https://127.0.0.1/test', 'https://fcm.googleapis.com.attacker.test/', 'https://fcm.googleapis.com@attacker.test/', 'https://fcm.googleapis.com:444/', 'https://attacker.test/', 'invalid']) {
    assert.equal(isAllowedPushEndpoint(endpoint), false, endpoint)
  }
})

test('republished teams replace the previous alert for the same match', () => {
  const teams = { ...event, type: 'teams_created' as const }
  assert.equal(buildPushPayload({ ...teams, notification_id: 'n1' }).tag, buildPushPayload({ ...teams, notification_id: 'n2' }).tag)
  assert.notEqual(buildPushPayload({ ...event, notification_id: 'n1' }).tag, buildPushPayload({ ...event, notification_id: 'n2' }).tag)
})
