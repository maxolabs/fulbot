import assert from 'node:assert/strict'
import test from 'node:test'
import { generateFallbackTeams } from './fallback-balancer'
import { goalkeeperPolicy, isDefenseCapable, sameSplit } from './constraints'
import { guestPlayerDefaults, validateHardConstraints, type PlayerInput } from './team-generator'

const player = (id: string, rating: number, extra: Partial<PlayerInput> = {}): PlayerInput => ({
  id, displayName: id, nickname: null, mainPosition: 'CM', preferredPositions: ['CM'], overallRating: rating,
  skills: null, tags: [], footedness: 'right', goalkeeperWillingness: 0, fitnessStatus: 'ok', memberScore: 3.5,
  matchesPlayed: 0, goals: 0, assists: 0, ...extra,
})
const pool = (n: number) => Array.from({ length: n }, (_, i) => player(`p${i}`, 2 + (i % 5) * 0.5))
const split = (r: { dark: { playerId: string }[]; light: { playerId: string }[] }) =>
  ({ dark: r.dark.map((a) => a.playerId), light: r.light.map((a) => a.playerId) })

test('goalkeeper minimum is hard only with enough GK-willing players for both teams', () => {
  const players = pool(10)
  assert.equal(goalkeeperPolicy(players, []).hard, false)
  players[0].goalkeeperWillingness = 2
  assert.equal(goalkeeperPolicy(players, []).hard, false)
  players[1].goalkeeperWillingness = 1
  assert.deepEqual(goalkeeperPolicy(players, []), { required: 1, willing: 2, hard: true })
  assert.equal(goalkeeperPolicy(players, [{ type: 'min_goalkeepers', value: 2 }]).hard, false)
})

test('a lineup without keepers is valid when nobody is GK-willing', () => {
  const players = pool(10)
  const result = generateFallbackTeams(players, [], 5)
  assert.deepEqual(validateHardConstraints(players, [], result), [])
})

test('guests are not GK-willing by default', () => {
  assert.equal(guestPlayerDefaults({ id: 'g', displayName: 'G' }).goalkeeperWillingness, 0)
})

test('a seeded rerun differs from the previous lineup', () => {
  const players = pool(14)
  const first = generateFallbackTeams(players, [], 7)
  const again = generateFallbackTeams(players, [], 7)
  assert.ok(sameSplit(split(first), split(again)), 'unseeded runs are deterministic')
  const rerun = generateFallbackTeams(players, [], 7, { previous: split(first), seed: 42 })
  assert.ok(!sameSplit(split(first), split(rerun)))
  assert.deepEqual(validateHardConstraints(players, [], rerun), [])
})

test('min_defenders is honored by swapping a defender across', () => {
  // The defenders are picks 2 and 3 of the snake draft, so both land on
  // light unless the balancer fixes it; require 1 per team.
  const players = pool(10)
  players[7] = player('star', 5)
  players[8] = player('d1', 4.9, { mainPosition: 'CB', preferredPositions: ['CB'] })
  players[9] = player('d2', 4.8, { mainPosition: 'RB', preferredPositions: ['RB'] })
  const rules = [{ type: 'min_defenders' as const, value: 1 }]
  const result = generateFallbackTeams(players, rules, 5)
  for (const team of [result.dark, result.light]) {
    assert.ok(team.some((a) => isDefenseCapable(players.find((p) => p.id === a.playerId)!)))
  }
  assert.deepEqual(validateHardConstraints(players, rules, result), [])
})
