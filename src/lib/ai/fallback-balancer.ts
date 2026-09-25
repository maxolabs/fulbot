import type { PlayerInput, RuleInput, GeneratedTeams, TeamAssignment, PreviousLineup } from './team-generator'
import { getFormation } from '@/lib/formations'
import { getTranslation, type Language, type TranslateFn } from '@/i18n/core'
import { isDefenseCapable, isGoalkeeperWilling, sameSplit } from './constraints'

// Rule-based team balancer used when OPENAI_API_KEY is missing, or when the AI
// response keeps failing hard-constraint validation after a retry.
//
// Strategy:
// 1. Group players into "units": normally one player each, merged into a single unit
//    when a force_pair rule links them (so they always move together).
// 2. Seed the two teams with the two most goalkeeper-willing units on opposite teams.
// 3. Snake-draft the remaining units by rating (descending), alternating team picks
//    every other pick (1-2-2-1-1-2-2-1...), swapping a unit to the other team when it
//    would violate an avoid_pair rule (if possible).
// 4. Rebalance sizes if they ended up more than 1 apart.
// 5. Honor a min_defenders rule by swapping a defender for a non-defender of
//    similar rating between the teams.
// 6. Assign positions within each team from a simple formation, matching each
//    player's main/preferred position where possible, and picking the most
//    goalkeeper-willing player for GK slots.
//
// Without a seed the result is deterministic. With a seed (sent on "Regenerar")
// the draft order gets a small random jitter, several candidates are drawn and
// one that differs from the previous lineup is chosen among the best balanced.

export interface FallbackOptions {
  language?: Language
  previous?: PreviousLineup | null
  seed?: number
}

interface Unit {
  ids: string[]
  members: PlayerInput[]
  rating: number
}

type Team = 'dark' | 'light'

function findRoot(parents: Map<string, string>, id: string): string {
  let root = id
  while (parents.get(root) && parents.get(root) !== root) {
    root = parents.get(root) as string
  }
  return root
}

function buildUnits(players: PlayerInput[], rules: RuleInput[]): Unit[] {
  const parents = new Map<string, string>()
  players.forEach((p) => parents.set(p.id, p.id))

  for (const rule of rules) {
    if (rule.type === 'force_pair' && rule.playerIds && rule.playerIds.length === 2) {
      const [a, b] = rule.playerIds
      if (parents.has(a) && parents.has(b)) {
        const rootA = findRoot(parents, a)
        const rootB = findRoot(parents, b)
        if (rootA !== rootB) parents.set(rootA, rootB)
      }
    }
  }

  const groups = new Map<string, PlayerInput[]>()
  for (const p of players) {
    const root = findRoot(parents, p.id)
    const list = groups.get(root) || []
    list.push(p)
    groups.set(root, list)
  }

  return Array.from(groups.values()).map((members) => ({
    ids: members.map((m) => m.id),
    members,
    rating: members.reduce((s, m) => s + m.overallRating, 0) / members.length,
  }))
}

// Standard 2-team snake draft order: pick1=dark, pick2=light, pick3=light, pick4=dark, ...
function snakeTeamForPick(pick: number): Team {
  const roundIndex = Math.floor((pick - 1) / 2)
  const positionInRound = (pick - 1) % 2
  const order: ['dark', 'light'] | ['light', 'dark'] = roundIndex % 2 === 0 ? ['dark', 'light'] : ['light', 'dark']
  return order[positionInRound]
}

// Small seeded PRNG (mulberry32): the same seed gives the same lineup.
function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Rating jitter used to vary the draft order on regeneration. Big enough to
// swap players of similar level, small enough to keep the teams balanced.
const JITTER = 0.8
const CANDIDATES = 12
// Candidates this close to the best balance are all acceptable picks.
const BALANCE_TOLERANCE = 0.05

function balanceOnce(
  players: PlayerInput[],
  rules: RuleInput[],
  teamSize: number | undefined,
  t: TranslateFn,
  random: (() => number) | null
): GeneratedTeams {
  const warnings: string[] = []
  const n = players.length
  const providedTeamSize = teamSize && teamSize > 0 ? Math.min(teamSize, n) : Math.ceil(n / 2)
  const targetDark = providedTeamSize
  const targetLight = n - providedTeamSize

  const avoidPairs: [string, string][] = rules
    .filter((r) => r.type === 'avoid_pair' && r.playerIds && r.playerIds.length === 2)
    .map((r) => [r.playerIds![0], r.playerIds![1]])

  const units = buildUnits(players, rules)
  const unitById = new Map<string, Unit>()
  for (const u of units) for (const id of u.ids) unitById.set(id, u)
  const playerById = new Map(players.map((p) => [p.id, p]))

  const teamMembers: Record<Team, string[]> = { dark: [], light: [] }

  const placeUnit = (unit: Unit, team: Team) => {
    for (const id of unit.ids) teamMembers[team].push(id)
  }

  const conflicts = (ids: string[], teamIds: string[]) =>
    avoidPairs.some(([a, b]) =>
      (ids.includes(a) && teamIds.includes(b)) || (ids.includes(b) && teamIds.includes(a))
    )
  const violatesAvoidPair = (unit: Unit, team: Team) => conflicts(unit.ids, teamMembers[team])

  // Step 1: seed the two teams with the two most goalkeeper-willing (distinct) units
  const gkSkill = (p: PlayerInput) => p.skills?.goalkeeping ?? 0
  const gkSorted = players
    .filter(isGoalkeeperWilling)
    .sort((a, b) =>
      b.goalkeeperWillingness - a.goalkeeperWillingness ||
      gkSkill(b) - gkSkill(a) ||
      b.overallRating - a.overallRating
    )

  const preassignedUnits = new Set<Unit>()
  const gkUnitsPicked: Unit[] = []
  for (const p of gkSorted) {
    const unit = unitById.get(p.id)
    if (!unit || gkUnitsPicked.includes(unit)) continue
    gkUnitsPicked.push(unit)
    if (gkUnitsPicked.length >= 2) break
  }

  let pickCounter = 1
  if (gkUnitsPicked[0]) {
    placeUnit(gkUnitsPicked[0], 'dark')
    preassignedUnits.add(gkUnitsPicked[0])
    pickCounter++
  }
  if (gkUnitsPicked[1]) {
    const team = violatesAvoidPair(gkUnitsPicked[1], 'light') ? 'dark' : 'light'
    placeUnit(gkUnitsPicked[1], team)
    preassignedUnits.add(gkUnitsPicked[1])
    pickCounter++
  }
  // A short GK pool is reported once by generateTeams (ui.teamsAi.gkNone/gkFew).

  // Step 2: snake draft the rest, sorted by rating descending (jittered when seeded)
  const draftRating = new Map(units.map((u) => [u, u.rating + (random ? (random() - 0.5) * JITTER : 0)]))
  const remainingUnits = units
    .filter((u) => !preassignedUnits.has(u))
    .sort((a, b) => draftRating.get(b)! - draftRating.get(a)!)

  for (const unit of remainingUnits) {
    let team = snakeTeamForPick(pickCounter)
    const other: Team = team === 'dark' ? 'light' : 'dark'
    const teamTarget = team === 'dark' ? targetDark : targetLight
    const otherTarget = team === 'dark' ? targetLight : targetDark

    // Keep sizes on track when a multi-member (force_pair) unit would overflow
    if (
      teamMembers[team].length + unit.ids.length > teamTarget &&
      teamMembers[other].length + unit.ids.length <= otherTarget
    ) {
      team = other
    }

    if (violatesAvoidPair(unit, team)) {
      const alt = team === 'dark' ? 'light' : 'dark'
      if (!violatesAvoidPair(unit, alt)) {
        team = alt
      } else {
        warnings.push(t('ui.teamsAi.avoidPairFailed', { names: unit.members.map((m) => m.displayName).join(', ') }))
      }
    }

    placeUnit(unit, team)
    pickCounter++
  }

  // Step 3: rebalance sizes if off by more than 1 (move a movable single-member unit)
  let diff = teamMembers.dark.length - teamMembers.light.length
  let guard = 0
  while (Math.abs(diff) > 1 && guard < players.length) {
    guard++
    const bigger: Team = diff > 0 ? 'dark' : 'light'
    const smaller: Team = bigger === 'dark' ? 'light' : 'dark'

    const movableId = teamMembers[bigger].find((id) => {
      const unit = unitById.get(id)
      return unit && unit.ids.length === 1 && !violatesAvoidPair(unit, smaller)
    })

    if (!movableId) break

    teamMembers[bigger] = teamMembers[bigger].filter((id) => id !== movableId)
    teamMembers[smaller].push(movableId)
    diff = teamMembers.dark.length - teamMembers.light.length
  }

  // Step 4: min_defenders. Swap a defense-capable player from the other team
  // (which must keep its own minimum) for a non-defender of the closest
  // rating. Only single-player units that weren't seeded as keepers move.
  const minDefRule = rules.find((r) => r.type === 'min_defenders')
  if (minDefRule) {
    const required = minDefRule.value ?? 1
    const isDef = (id: string) => {
      const p = playerById.get(id)
      return p ? isDefenseCapable(p) : false
    }
    const defCount = (team: Team) => teamMembers[team].filter(isDef).length
    const movable = (id: string) => {
      const unit = unitById.get(id)
      return !!unit && unit.ids.length === 1 && !preassignedUnits.has(unit)
    }
    const rating = (id: string) => playerById.get(id)?.overallRating ?? 0

    for (const team of ['dark', 'light'] as const) {
      const other: Team = team === 'dark' ? 'light' : 'dark'
      let swaps = 0
      while (defCount(team) < required && swaps < players.length) {
        swaps++
        let best: { incoming: string; outgoing: string; gap: number } | null = null
        if (defCount(other) - 1 >= required) {
          for (const incoming of teamMembers[other].filter((id) => isDef(id) && movable(id))) {
            for (const outgoing of teamMembers[team].filter((id) => !isDef(id) && movable(id))) {
              const teamAfter = teamMembers[team].filter((id) => id !== outgoing)
              const otherAfter = teamMembers[other].filter((id) => id !== incoming)
              if (conflicts([incoming], teamAfter) || conflicts([outgoing], otherAfter)) continue
              const gap = Math.abs(rating(incoming) - rating(outgoing))
              if (!best || gap < best.gap) best = { incoming, outgoing, gap }
            }
          }
        }
        if (!best) break
        const { incoming, outgoing } = best
        teamMembers[team] = [...teamMembers[team].filter((id) => id !== outgoing), incoming]
        teamMembers[other] = [...teamMembers[other].filter((id) => id !== incoming), outgoing]
      }
      if (defCount(team) < required) {
        warnings.push(t('ui.teamsAi.minDefendersFailed', { team: t(`ui.teamsScreen.${team}`), n: required }))
      }
    }
  }

  // Step 5: assign positions within each team
  const buildTeamAssignments = (ids: string[]): TeamAssignment[] => {
    const teamPlayers = ids
      .map((id) => playerById.get(id))
      .filter((p): p is PlayerInput => Boolean(p))
      .sort((a, b) => b.overallRating - a.overallRating)

    const formation = getFormation(teamPlayers.length)
    const remaining = [...teamPlayers]
    const assignments: TeamAssignment[] = []

    formation.forEach((pos) => {
      if (pos !== 'GK') return
      remaining.sort((a, b) => b.goalkeeperWillingness - a.goalkeeperWillingness || b.overallRating - a.overallRating)
      const gk = remaining.shift()
      if (gk) {
        assignments.push({ playerId: gk.id, position: 'GK', reason: t('ui.teamsAi.reasonGoalkeeper') })
      }
    })

    formation.forEach((pos) => {
      if (pos === 'GK') return
      let idx = remaining.findIndex((p) => p.mainPosition === pos || p.preferredPositions.includes(pos))
      if (idx === -1) idx = 0
      const player = remaining.splice(idx, 1)[0]
      if (player) {
        assignments.push({ playerId: player.id, position: pos, reason: t('ui.teamsAi.reasonField') })
      }
    })

    return assignments
  }

  const darkAssignments = buildTeamAssignments(teamMembers.dark)
  const lightAssignments = buildTeamAssignments(teamMembers.light)

  const avgRating = (ids: string[]) => {
    const list = ids.map((id) => playerById.get(id)).filter((p): p is PlayerInput => Boolean(p))
    return list.length > 0 ? list.reduce((s, p) => s + p.overallRating, 0) / list.length : 0
  }

  const darkAvg = avgRating(teamMembers.dark)
  const lightAvg = avgRating(teamMembers.light)
  const maxAvg = Math.max(darkAvg, lightAvg, 1)
  const balanceScore = Math.max(0, Math.min(1, 1 - Math.abs(darkAvg - lightAvg) / maxAvg))

  return {
    dark: darkAssignments,
    light: lightAssignments,
    reasoning: t('ui.teamsAi.fallbackReasoning'),
    balanceScore,
    warnings,
  }
}

export function generateFallbackTeams(
  players: PlayerInput[],
  rules: RuleInput[] = [],
  teamSize?: number,
  options: FallbackOptions = {}
): GeneratedTeams {
  const t = getTranslation(options.language ?? 'es')
  const previous = options.previous ?? null

  if (options.seed === undefined && !previous) {
    return balanceOnce(players, rules, teamSize, t, null)
  }

  // Regeneration: draw a few jittered candidates, keep the ones that differ
  // from the published lineup and pick one of the best balanced among them.
  const random = seededRandom(options.seed ?? 1)
  const candidates: GeneratedTeams[] = []
  for (let i = 0; i < CANDIDATES; i++) {
    candidates.push(balanceOnce(players, rules, teamSize, t, random))
  }
  const split = (c: GeneratedTeams) => ({ dark: c.dark.map((a) => a.playerId), light: c.light.map((a) => a.playerId) })
  const different = previous ? candidates.filter((c) => !sameSplit(previous, split(c))) : candidates
  if (different.length === 0) {
    const result = balanceOnce(players, rules, teamSize, t, null)
    return { ...result, warnings: [...result.warnings, t('ui.teamsAi.noAlternative')] }
  }
  const bestScore = Math.max(...different.map((c) => c.balanceScore))
  const good = different.filter((c) => c.balanceScore >= bestScore - BALANCE_TOLERANCE)
  return good[Math.floor(random() * good.length)]
}
