// Fixed formations by team size. Used to render the lineup field (web + exported
// image) and by the fallback balancer so assigned positions match the drawn slots.
//
// Slot order matters: within a line, slots are laid out right-to-left as listed
// (RB on the right side of the field, LB on the left, from the team's own
// perspective attacking upward).

export const FORMATIONS: Record<number, readonly string[]> = {
  5: ['GK', 'CB', 'CM', 'CM', 'ST'],
  6: ['GK', 'CB', 'CB', 'CM', 'CM', 'ST'],
  7: ['GK', 'RB', 'CB', 'LB', 'CM', 'CM', 'ST'],
  8: ['GK', 'RB', 'CB', 'LB', 'CM', 'CDM', 'CM', 'ST'],
  9: ['GK', 'RB', 'CB', 'LB', 'CM', 'CDM', 'CM', 'ST', 'ST'],
  11: ['GK', 'RB', 'CB', 'CB', 'LB', 'CM', 'CDM', 'CDM', 'CM', 'ST', 'ST'],
}

// Sizes without an explicit formation: below 5 shrink a minimal spine, 10 is
// the 9-a-side shape plus a CB, above 11 pad the 11-a-side shape with CMs.
export function getFormation(size: number): string[] {
  if (size <= 0) return []
  const exact = FORMATIONS[size]
  if (exact) return [...exact]
  if (size < 5) return ['GK', 'CB', 'ST', 'CM'].slice(0, size)
  if (size === 10) return ['GK', 'RB', 'CB', 'CB', 'LB', 'CM', 'CDM', 'CM', 'ST', 'ST']
  const base = [...FORMATIONS[11]]
  while (base.length < size) base.push('CM')
  return base
}

// Order of lines from the goalkeeper (bottom) to the strikers (top). Lines that
// exist in a formation are spread evenly between GK_Y and FWD_Y so the exported
// image and the web field never stack two lines on top of each other.
const LINE_RANK: Record<string, number> = {
  GK: 0,
  RB: 1, CB: 1, LB: 1,
  CDM: 2,
  CM: 3, LM: 3, RM: 3,
  CAM: 4,
  ST: 5, CF: 5, LW: 5, RW: 5,
}
const GK_Y = 86
const FWD_Y = 14

export interface FormationSlot {
  position: string
  x: number
  y: number
}

function spreadX(count: number, index: number): number {
  if (count <= 1) return 50
  const halfWidth = count === 2 ? 18 : count === 3 ? 30 : 36
  return Math.round(50 - halfWidth + (index * (2 * halfWidth)) / (count - 1))
}

// Coordinates for every slot in a formation, spreading slots on the same line
// evenly across the field.
export function getFormationSlots(size: number): FormationSlot[] {
  return slotsForPositions(getFormation(size))
}

function slotsForPositions(positions: readonly string[]): FormationSlot[] {
  const ranks = Array.from(new Set(positions.map((pos) => LINE_RANK[pos] ?? 3))).sort((a, b) => a - b)
  const lineY = new Map<number, number>()
  ranks.forEach((rank, i) => {
    const y = ranks.length === 1 ? 50 : GK_Y - (i * (GK_Y - FWD_Y)) / (ranks.length - 1)
    lineY.set(rank, Math.round(y))
  })

  const byLine = new Map<number, number[]>()
  positions.forEach((pos, i) => {
    const rank = LINE_RANK[pos] ?? 3
    const line = byLine.get(rank) ?? []
    line.push(i)
    byLine.set(rank, line)
  })

  const slots: FormationSlot[] = positions.map((position) => ({
    position,
    x: 50,
    y: lineY.get(LINE_RANK[position] ?? 3) ?? 50,
  }))
  byLine.forEach((indices) => {
    // Keep right/left roles on their actual side, even after manual moves.
    const side = (position: string) => position.startsWith('R') ? -1 : position.startsWith('L') ? 1 : 0
    indices.sort((a, b) => side(positions[a]) - side(positions[b]))
    indices.forEach((slotIndex, i) => {
      slots[slotIndex].x = spreadX(indices.length, indices.length - 1 - i)
    })
  })
  return slots
}

export interface PlacedPlayer<T> {
  player: T
  slot: FormationSlot
}

// Draw the saved positions, including manually chosen formations. A fixed
// size-based shape must never silently turn an assigned forward into a keeper.
export function placePlayersInFormation<T extends { position: string }>(players: T[]): PlacedPlayer<T>[] {
  const slots = slotsForPositions(players.map((player) => player.position))
  return players.map((player, index) => ({ player, slot: slots[index] }))
}
