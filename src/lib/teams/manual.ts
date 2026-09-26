export type TeamSlot = 'pool' | 'dark' | 'light'

export interface BuilderPlayer {
  id: string
  playerId: string | null
  guestPlayerId: string | null
  displayName: string
  nickname: string | null
  mainPosition: string
  overallRating: number
  position: string
}

export type TeamDraft = Record<TeamSlot, BuilderPlayer[]>
export const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF'] as const
export type Position = (typeof POSITIONS)[number]

// Profiles and older lineups store free text; publish_match_teams only
// accepts the codes above, so anything else starts as a midfielder.
export function normalizePosition(value: string | null | undefined): string {
  const upper = (value ?? '').trim().toUpperCase()
  return (POSITIONS as readonly string[]).includes(upper) ? upper : 'CM'
}

// The confirmed roster changed while editing: keep every placement that is
// still valid, drop players who left and put newcomers in the pool.
export function syncRoster(draft: TeamDraft, roster: BuilderPlayer[]): TeamDraft {
  const ids = new Set(roster.map((p) => p.id))
  const placed = new Set([...draft.pool, ...draft.dark, ...draft.light].map((p) => p.id))
  return {
    pool: [...draft.pool.filter((p) => ids.has(p.id)), ...roster.filter((p) => !placed.has(p.id))],
    dark: draft.dark.filter((p) => ids.has(p.id)),
    light: draft.light.filter((p) => ids.has(p.id)),
  }
}

export function movePlayer(draft: TeamDraft, id: string, destination: TeamSlot): TeamDraft {
  const source = (['pool', 'dark', 'light'] as const).find((team) => draft[team].some((p) => p.id === id))
  if (!source || source === destination) return draft
  const player = draft[source].find((p) => p.id === id)!
  return {
    ...draft,
    [source]: draft[source].filter((p) => p.id !== id),
    [destination]: [...draft[destination], player],
  }
}

export function draftProblem(draft: TeamDraft): 'minimum' | 'unassigned' | 'uneven' | 'duplicate' | null {
  const players = [...draft.pool, ...draft.dark, ...draft.light]
  if (players.length < 4) return 'minimum'
  if (new Set(players.map((p) => p.id)).size !== players.length) return 'duplicate'
  if (draft.pool.length) return 'unassigned'
  if (!draft.dark.length || !draft.light.length || Math.abs(draft.dark.length - draft.light.length) > 1) return 'uneven'
  return null
}

export function assignmentPayload(draft: TeamDraft) {
  return (['dark', 'light'] as const).flatMap((team) => draft[team].map((player, index) => ({
    team,
    player_id: player.playerId,
    guest_player_id: player.guestPlayerId,
    position: player.position,
    order_index: index,
    source: 'manual' as const,
  })))
}

export interface PairRule {
  type: 'avoid_pair' | 'force_pair'
  playerIds: [string, string]
}

export type LineupWarning =
  | { kind: 'noKeeper'; team: 'dark' | 'light' }
  | { kind: 'manyKeepers'; team: 'dark' | 'light'; count: number }
  | { kind: 'avoidPairBroken' | 'forcePairBroken'; names: [string, string] }

// Non-blocking checks for the manual builder: each team should have exactly
// one GK, and the group's pair rules should hold. Rules about players who are
// not in this draft are ignored; a player still in the pool doesn't count as
// placed yet.
export function lineupWarnings(draft: TeamDraft, rules: PairRule[] = []): LineupWarning[] {
  const warnings: LineupWarning[] = []
  for (const team of ['dark', 'light'] as const) {
    if (draft[team].length === 0) continue
    const keepers = draft[team].filter((p) => p.position === 'GK').length
    if (keepers === 0) warnings.push({ kind: 'noKeeper', team })
    else if (keepers > 1) warnings.push({ kind: 'manyKeepers', team, count: keepers })
  }

  const teamOf = new Map<string, 'dark' | 'light'>()
  const nameOf = new Map<string, string>()
  for (const team of ['dark', 'light'] as const) {
    for (const p of draft[team]) {
      teamOf.set(p.id, team)
      nameOf.set(p.id, p.displayName)
    }
  }
  for (const rule of rules) {
    const [a, b] = rule.playerIds
    const teamA = teamOf.get(a)
    const teamB = teamOf.get(b)
    if (!teamA || !teamB) continue
    const names: [string, string] = [nameOf.get(a) ?? a, nameOf.get(b) ?? b]
    if (rule.type === 'avoid_pair' && teamA === teamB) warnings.push({ kind: 'avoidPairBroken', names })
    if (rule.type === 'force_pair' && teamA !== teamB) warnings.push({ kind: 'forcePairBroken', names })
  }
  return warnings
}
