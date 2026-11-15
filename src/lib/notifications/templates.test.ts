import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderNotificationText } from './templates'
import { buildPushPayload } from './push-payload'
import type { LineupChangedPayload, NotificationEvent } from './types'

const TZ = 'America/Argentina/Buenos_Aires'

const base: LineupChangedPayload = {
  match_id: 'match-1',
  group_name: 'Fútbol del lunes',
  date_time: '2026-11-17T00:00:00Z',
  left: [{ name: 'Agus', player_id: 'p-agus', guest: false }],
  promoted: [{ name: 'Gonza', player_id: 'p-gonza', guest: false }],
  spots_left: 0,
  recipient_player_id: 'p-maxo',
}

const lineup = (payload: Partial<LineupChangedPayload>): NotificationEvent => ({
  type: 'lineup_changed',
  payload: { ...base, ...payload },
})

test('lineup_changed: the promoted player took the slot, no review asked (OD-2)', () => {
  const text = renderNotificationText(
    lineup({ phase: 'teams', swaps: [{ left: 'Agus', in: 'Gonza', team: 'dark', position: 'GK' }], needs_review: false }),
    TZ,
    { channel: 'inapp' }
  )
  assert.match(text, /^Agus ya no está en el partido/)
  assert.match(text, /Gonza entra de la lista de espera y ocupa su lugar en Oscuro\./)
  assert.match(text, /No hace falta tocar los equipos\./)
  assert.doesNotMatch(text, /Revisá los equipos/)
})

test('lineup_changed: several swaps name who replaced whom', () => {
  const text = renderNotificationText(
    lineup({
      phase: 'teams',
      left: [
        { name: 'Agus', player_id: 'p-agus', guest: false },
        { name: 'Invitado A', player_id: null, guest: true },
      ],
      promoted: [
        { name: 'Gonza', player_id: 'p-gonza', guest: false },
        { name: 'Invitado C', player_id: null, guest: true },
      ],
      swaps: [
        { left: 'Agus', in: 'Gonza', team: 'dark', position: 'GK' },
        { left: 'Invitado A', in: 'Invitado C', team: 'light', position: 'ST' },
      ],
    }),
    TZ,
    { channel: 'inapp', language: 'en' }
  )
  assert.match(text, /In from the waitlist: Gonza for Agus \(.+\) and Invitado C for Invitado A \(.+\)\./)
})

test('lineup_changed: a gap left after the swap still asks for a review', () => {
  const text = renderNotificationText(
    lineup({ phase: 'teams', swaps: [{ left: 'Agus', in: 'Gonza', team: 'light', position: 'CB' }], needs_review: true }),
    TZ,
    { channel: 'inapp' }
  )
  assert.match(text, /en Claro\. Revisá los equipos\.$/)
})

test('lineup_changed: late drop-out before the teams (OD-11)', () => {
  const text = renderNotificationText(lineup({ phase: 'late', swaps: [] }), TZ, { channel: 'inapp' })
  assert.match(text, /a pocas horas de jugar\. Entra Gonza de la lista de espera\.$/)
  assert.doesNotMatch(text, /equipos/)
  const empty = renderNotificationText(lineup({ phase: 'late', promoted: [], spots_left: 1 }), TZ, { channel: 'inapp' })
  assert.match(empty, /queda 1 lugar libre\.$/)
})

test('lineup_changed: rows from before 00034 keep the old text', () => {
  const text = renderNotificationText(lineup({ promoted: [], spots_left: 2 }), TZ, { channel: 'inapp' })
  assert.match(text, /con los equipos ya armados\. No hay nadie en espera: quedan 2 lugares libres\. Revisá los equipos\.$/)
})

test('waitlist_promoted: says the team and position taken over', () => {
  const event: NotificationEvent = {
    type: 'waitlist_promoted',
    payload: { signup_id: 's-1', player_name: 'Gonza', recipient_player_id: 'p-gonza', team: 'dark', position: 'GK' },
  }
  assert.match(renderNotificationText(event, TZ, { channel: 'inapp' }), /Jugás en Oscuro \(Arquero\)\.$/)
  assert.match(renderNotificationText(event, TZ), /Juega en Oscuro \(Arquero\)\.$/)
  const before: NotificationEvent = {
    type: 'waitlist_promoted',
    payload: { signup_id: 's-1', player_name: 'Gonza', recipient_player_id: 'p-gonza', team: null, position: null },
  }
  assert.doesNotMatch(renderNotificationText(before, TZ, { channel: 'inapp' }), /Jugás/)
})

test('push: a late drop-out opens the match, a teams drop-out the teams', () => {
  const common = {
    notification_id: 'n-1', type: 'lineup_changed' as const, match_id: 'match-1', group_slug: 'lunes',
    group_name: 'Fútbol del lunes', timezone: TZ, language: 'es' as const,
  }
  assert.equal(buildPushPayload({ ...common, payload: { phase: 'late' } }).url, '/groups/lunes/matches/match-1')
  assert.equal(buildPushPayload({ ...common, payload: { phase: 'teams' } }).url, '/groups/lunes/matches/match-1/teams')
})
