import type { PlayerInput, RuleInput } from './team-generator'

// Constraint helpers shared by the AI validator and the fallback balancer.

export const DEFENDER_POSITIONS = ['CB', 'LB', 'RB']

export function isDefenseCapable(player: PlayerInput): boolean {
  return DEFENDER_POSITIONS.includes(player.mainPosition) ||
    player.preferredPositions.some((pos) => DEFENDER_POSITIONS.includes(pos))
}

// "GK-willing" means goalkeeper_willingness >= 1, i.e. anything but "never"
// (the profile default is 0). Guests come in as 0: we don't know them.
export function isGoalkeeperWilling(player: PlayerInput): boolean {
  return player.goalkeeperWillingness >= 1
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
