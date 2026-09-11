import type { PlayerInput, RuleInput, GeneratedTeams, TeamAssignment } from './team-generator'
import { getFormation } from '@/lib/formations'

// Deterministic team balancer used when OPENAI_API_KEY is missing, or when the AI
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
// 5. Assign positions within each team from a simple formation, matching each
//    player's main/preferred position where possible, and picking the most
//    goalkeeper-willing player for GK slots.

interface Unit {
  ids: string[]
  members: PlayerInput[]
  rating: number
}

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
function snakeTeamForPick(pick: number): 'dark' | 'light' {
  const roundIndex = Math.floor((pick - 1) / 2)
  const positionInRound = (pick - 1) % 2
  const order: ['dark', 'light'] | ['light', 'dark'] = roundIndex % 2 === 0 ? ['dark', 'light'] : ['light', 'dark']
  return order[positionInRound]
}

export function generateFallbackTeams(
  players: PlayerInput[],
  rules: RuleInput[] = [],
  teamSize?: number
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

  const teamMembers: Record<'dark' | 'light', string[]> = { dark: [], light: [] }

  const placeUnit = (unit: Unit, team: 'dark' | 'light') => {
    for (const id of unit.ids) teamMembers[team].push(id)
  }

  const violatesAvoidPair = (unit: Unit, team: 'dark' | 'light') =>
    avoidPairs.some(([a, b]) => {
      const hasA = unit.ids.includes(a)
      const hasB = unit.ids.includes(b)
      if (hasA && teamMembers[team].includes(b)) return true
      if (hasB && teamMembers[team].includes(a)) return true
      return false
    })

  // Step 1: seed the two teams with the two most goalkeeper-willing (distinct) units
  const gkSkill = (p: PlayerInput) => p.skills?.goalkeeping ?? 0
  const gkSorted = [...players]
    .filter((p) => p.goalkeeperWillingness >= 1)
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

  if (gkUnitsPicked.length === 0) {
    warnings.push('Ningún jugador confirmado se ofrece como arquero; se asignará el arco de todos modos.')
  } else if (gkUnitsPicked.length === 1) {
    warnings.push('Sólo hay un jugador con disponibilidad para el arco; un equipo quedará sin arquero natural.')
  }

  // Step 2: snake draft the rest, sorted by rating descending
  const remainingUnits = units
    .filter((u) => !preassignedUnits.has(u))
    .sort((a, b) => b.rating - a.rating)

  for (const unit of remainingUnits) {
    let team = snakeTeamForPick(pickCounter)
    const other: 'dark' | 'light' = team === 'dark' ? 'light' : 'dark'
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
        warnings.push(
          `No se pudo respetar la regla de separar jugadores para: ${unit.members.map((m) => m.displayName).join(', ')}`
        )
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
    const bigger: 'dark' | 'light' = diff > 0 ? 'dark' : 'light'
    const smaller: 'dark' | 'light' = bigger === 'dark' ? 'light' : 'dark'

    const movableId = teamMembers[bigger].find((id) => {
      const unit = unitById.get(id)
      return unit && unit.ids.length === 1 && !violatesAvoidPair(unit, smaller)
    })

    if (!movableId) break

    teamMembers[bigger] = teamMembers[bigger].filter((id) => id !== movableId)
    teamMembers[smaller].push(movableId)
    diff = teamMembers.dark.length - teamMembers.light.length
  }

  // Step 4: assign positions within each team
  const buildTeamAssignments = (ids: string[]): TeamAssignment[] => {
    const teamPlayers = ids
      .map((id) => players.find((p) => p.id === id))
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
        assignments.push({ playerId: gk.id, position: 'GK', reason: 'Arquero por disponibilidad y balance de equipo' })
      }
    })

    formation.forEach((pos) => {
      if (pos === 'GK') return
      let idx = remaining.findIndex((p) => p.mainPosition === pos || p.preferredPositions.includes(pos))
      if (idx === -1) idx = 0
      const player = remaining.splice(idx, 1)[0]
      if (player) {
        assignments.push({ playerId: player.id, position: pos, reason: 'Balanceo determinístico por rating y posición' })
      }
    })

    return assignments
  }

  const darkAssignments = buildTeamAssignments(teamMembers.dark)
  const lightAssignments = buildTeamAssignments(teamMembers.light)

  const avgRating = (ids: string[]) => {
    const list = ids.map((id) => players.find((p) => p.id === id)).filter((p): p is PlayerInput => Boolean(p))
    return list.length > 0 ? list.reduce((s, p) => s + p.overallRating, 0) / list.length : 0
  }

  const darkAvg = avgRating(teamMembers.dark)
  const lightAvg = avgRating(teamMembers.light)
  const maxAvg = Math.max(darkAvg, lightAvg, 1)
  const balanceScore = Math.max(0, Math.min(1, 1 - Math.abs(darkAvg - lightAvg) / maxAvg))

  return {
    dark: darkAssignments,
    light: lightAssignments,
    reasoning: 'Balanceo determinístico',
    balanceScore,
    warnings,
  }
}
