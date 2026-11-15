import type { PlayerInput, RuleInput } from './team-generator'

// Constraint helpers shared by the AI validator and the fallback balancer.

export const DEFENDER_POSITIONS = ['CB', 'LB', 'RB']

export function isDefenseCapable(player: PlayerInput): boolean {
  return DEFENDER_POSITIONS.includes(player.mainPosition) ||
    player.preferredPositions.some((pos) => DEFENDER_POSITIONS.includes(pos))
}

// Peer data that says a player can keep goal even when their own profile
// says "never" (the profile default is 0): the "can_keep" tag, or a peer
// goalkeeping score of GK_SKILL_WILLING or more.
export const CAN_KEEP_TAG = 'can_keep'
export const GK_SKILL_WILLING = 3.5

function canKeep(player: PlayerInput): boolean {
  return player.tags.includes(CAN_KEEP_TAG) || (player.skills?.goalkeeping ?? 0) >= GK_SKILL_WILLING
}

// "GK-willing": goalkeeper_willingness >= 1 (anything but "never"), or peers
// say they can keep (tag or goalkeeping >= 3.5). Guests come in as 0 with no
// peer data: we don't know them.
export function isGoalkeeperWilling(player: PlayerInput): boolean {
  return player.goalkeeperWillingness >= 1 || canKeep(player)
}

// How good a pick for the GK slot a player is, higher first: own willingness
// (0-3), +1 for the can_keep tag, plus the peer goalkeeping score (1-5, 0 when
// unrated) weighted by half. With no data at all everyone scores 0 and the
// caller's tie-break decides (the balancer then keeps its best outfield
// players on the field).
export function gkScore(player: PlayerInput): number {
  return player.goalkeeperWillingness +
    (player.tags.includes(CAN_KEEP_TAG) ? 1 : 0) +
    (player.skills?.goalkeeping ?? 0) * 0.5
}

export interface GoalkeeperPolicy {
  /** GK-willing players each team should have: the min_goalkeepers rule value, default 1. */
  required: number
  /** GK-willing players in this match's pool. */
  willing: number
  /**
   * Hard only when the pool can give both teams their minimum, i.e.
   * willing >= 2 * required (at least 2 GK-willing players with the default).
   * Otherwise the goalkeeper minimum is a soft preference: it can't be met, and
   * treating it as hard would only burn the AI attempts and force the fallback.
   */
  hard: boolean
}

// True when two lineups put the same players together, whichever side each
// group is called (dark/light swapped counts as the same split).
export function sameSplit(
  a: { dark: string[]; light: string[] },
  b: { dark: string[]; light: string[] }
): boolean {
  const key = (ids: string[]) => [...ids].sort().join(',')
  const [aDark, aLight, bDark, bLight] = [key(a.dark), key(a.light), key(b.dark), key(b.light)]
  return (aDark === bDark && aLight === bLight) || (aDark === bLight && aLight === bDark)
}

export function goalkeeperPolicy(players: PlayerInput[], rules: RuleInput[]): GoalkeeperPolicy {
  const rule = rules.find((r) => r.type === 'min_goalkeepers')
  const required = Math.max(1, rule?.value ?? 1)
  const willing = players.filter(isGoalkeeperWilling).length
  return { required, willing, hard: willing >= required * 2 }
}

export interface DefendersPolicy {
  /** Defense-capable players each team should have; 0 when there is no min_defenders rule. */
  required: number
  /** Defense-capable players in this match's pool. */
  capable: number
  /**
   * Hard only when the pool can give both teams their minimum. Otherwise the
   * rule is a soft preference (with a warning), like the goalkeeper minimum:
   * a rule that can't be met would only burn the AI attempts.
   */
  hard: boolean
}

export function defendersPolicy(players: PlayerInput[], rules: RuleInput[]): DefendersPolicy {
  const rule = rules.find((r) => r.type === 'min_defenders')
  if (!rule) return { required: 0, capable: 0, hard: false }
  const required = Math.max(1, rule.value ?? 1)
  const capable = players.filter(isDefenseCapable).length
  return { required, capable, hard: capable >= required * 2 }
}

// Pair rules only matter when both players are in this match: a group rule
// about someone who didn't sign up would reach the prompt as a raw id.
export function rulesForPlayers(players: PlayerInput[], rules: RuleInput[]): RuleInput[] {
  const ids = new Set(players.map((p) => p.id))
  return rules.filter((r) =>
    (r.type !== 'avoid_pair' && r.type !== 'force_pair') ||
    (!!r.playerIds && r.playerIds.length === 2 && r.playerIds.every((id) => ids.has(id)))
  )
}
