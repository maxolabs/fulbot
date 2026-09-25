import assert from 'node:assert/strict'
import test from 'node:test'
import { assignmentPayload, draftProblem, movePlayer, normalizePosition, syncRoster, type BuilderPlayer, type TeamDraft } from './manual'
const player = (id: string, guest = false): BuilderPlayer => ({ id, playerId: guest ? null : id, guestPlayerId: guest ? id : null, displayName: id, nickname: null, mainPosition: 'CM', position: 'CM', overallRating: 2.5 })
const initial = (): TeamDraft => ({ pool: [player('a'), player('b'), player('c'), player('guest', true)], dark: [], light: [] })

test('can fill empty drop zones and move players back without losing or duplicating anyone', () => {
  const start = initial()
  let draft = movePlayer(start, 'a', 'dark')
  draft = movePlayer(draft, 'a', 'light')
  draft = movePlayer(draft, 'a', 'pool')
  assert.equal(draft.pool.length, 4)
  assert.equal(draft.dark.length + draft.light.length, 0)
  assert.equal(start.pool.length, 4)
  assert.equal(movePlayer(draft, 'missing', 'dark'), draft)
})
test('publishing requires all players, two balanced teams and at least four players', () => {
  let draft = initial()
  assert.equal(draftProblem(draft), 'unassigned')
  for (const id of ['a', 'b', 'c', 'guest']) draft = movePlayer(draft, id, 'dark')
  assert.equal(draftProblem(draft), 'uneven')
  for (const id of ['c', 'guest']) draft = movePlayer(draft, id, 'light')
  assert.equal(draftProblem(draft), null)
  draft.light.push(player('fifth'))
  assert.equal(draftProblem(draft), null)
  draft.light.push(player('a'))
  assert.equal(draftProblem(draft), 'duplicate')
  assert.equal(draftProblem({ pool: [], dark: [player('a')], light: [player('b')] }), 'minimum')
})
test('save preserves guest identity, positions and order', () => {
  const draft: TeamDraft = { pool: [], dark: [{ ...player('a'), position: 'GK' }, player('b')], light: [player('c'), player('guest', true)] }
  const payload = assignmentPayload(draft)
  assert.equal(payload[0].position, 'GK')
  assert.deepEqual(payload[3], { team: 'light', player_id: null, guest_player_id: 'guest', position: 'CM', order_index: 1, source: 'manual' })
})

import { placePlayersInFormation } from '../formations'
test('pitch keeps manually chosen positions and separates duplicate positions', () => {
  const lineup = [{ position: 'ST' }, { position: 'ST' }, { position: 'CAM' }, { position: 'GK' }]
  const placed = placePlayersInFormation(lineup)
  assert.deepEqual(placed.map((p) => p.slot.position), lineup.map((p) => p.position))
  assert.equal(new Set(placed.map((p) => `${p.slot.x},${p.slot.y}`)).size, 4)
  assert.ok(placed[0].slot.y < placed[3].slot.y)
})

test('free-text positions fall back to a code publish_match_teams accepts', () => {
  assert.equal(normalizePosition(' st '), 'ST')
  assert.equal(normalizePosition('Delantero'), 'CM')
  assert.equal(normalizePosition(null), 'CM')
})

test('a changed roster keeps placements, drops leavers and pools newcomers', () => {
  const draft: TeamDraft = { pool: [player('c')], dark: [player('a')], light: [player('b')] }
  const synced = syncRoster(draft, [player('a'), player('c'), player('d')])
  assert.deepEqual(synced.dark.map((p) => p.id), ['a'])
  assert.deepEqual(synced.light.map((p) => p.id), [])
  assert.deepEqual(synced.pool.map((p) => p.id), ['c', 'd'])
})
