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

// Position families used to place a player whose assigned position has no
// exact slot in the formation (e.g. an AI-assigned CAM in a formation without one).
const FAMILY: Record<string, string> = {
  GK: 'gk',
  CB: 'def', LB: 'def', RB: 'def',
  CDM: 'dm',
  CM: 'mid', CAM: 'mid', LM: 'mid', RM: 'mid',
  ST: 'fwd', CF: 'fwd', LW: 'fwd', RW: 'fwd',
}

// Second-choice families, in preference order, when the player's own family is full.
const NEIGHBOURS: Record<string, string[]> = {
  gk: ['def'],
  def: ['dm', 'mid'],
  dm: ['def', 'mid'],
  mid: ['dm', 'fwd', 'def'],
  fwd: ['mid', 'dm'],
}

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
  const positions = getFormation(size)
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
    // Listed right-to-left: first slot on the line gets the highest x.
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

// Assign players to formation slots: exact position first, then same family,
// then neighbouring families, then whatever is left. Every player gets a slot
// because the formation always has exactly players.length slots.
export function placePlayersInFormation<T extends { position: string }>(players: T[]): PlacedPlayer<T>[] {
  const slots = getFormationSlots(players.length)
  const taken = new Array<boolean>(slots.length).fill(false)
  const placed = new Array<PlacedPlayer<T> | null>(players.length).fill(null)

  const claim = (playerIndex: number, slotIndex: number) => {
    taken[slotIndex] = true
    placed[playerIndex] = { player: players[playerIndex], slot: slots[slotIndex] }
  }
  const findSlot = (pred: (position: string) => boolean) =>
    slots.findIndex((s, i) => !taken[i] && pred(s.position))

  // Pass 1: exact position match
  players.forEach((p, i) => {
    const slotIndex = findSlot((pos) => pos === p.position)
    if (slotIndex !== -1) claim(i, slotIndex)
  })

  // Pass 2: same family, then neighbouring families
  players.forEach((p, i) => {
    if (placed[i]) return
    const family = FAMILY[p.position]
    if (!family) return
    for (const candidate of [family, ...(NEIGHBOURS[family] ?? [])]) {
      const slotIndex = findSlot((pos) => FAMILY[pos] === candidate)
      if (slotIndex !== -1) {
        claim(i, slotIndex)
        return
      }
    }
  })

  // Pass 3: fill remaining slots in order
  players.forEach((p, i) => {
    if (placed[i]) return
    const slotIndex = findSlot(() => true)
    if (slotIndex !== -1) claim(i, slotIndex)
  })

  return placed.filter((p): p is PlacedPlayer<T> => p !== null)
}
