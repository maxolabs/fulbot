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
