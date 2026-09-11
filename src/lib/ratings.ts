// Initial scoring: shared vocabulary for peer ratings (see migration 00018_peer_ratings.sql).
//
// Peers rate each other per group on four 1-5 dimensions plus structured tags. The
// database aggregates everything into player_rating_summary, which only admins and
// captains can read; the pieces below are what the rating form, the score displays
// and the team generator agree on.

export const RATING_DIMENSIONS = ['goalkeeping', 'defense', 'attack', 'physical'] as const
export type RatingDimension = (typeof RATING_DIMENSIONS)[number]

export const DIMENSION_LABELS: Record<RatingDimension, string> = {
  goalkeeping: 'Arquero',
  defense: 'Defensa',
  attack: 'Ataque',
  physical: 'Físico',
}

export const DIMENSION_SHORT: Record<RatingDimension, string> = {
  goalkeeping: 'ARQ',
  defense: 'DEF',
  attack: 'ATA',
  physical: 'FÍS',
}

export const DIMENSION_HINTS: Record<RatingDimension, string> = {
  goalkeeping: '¿Qué tal ataja? 1 = mejor que no, 5 = arquero de verdad',
  defense: 'Marca, cobertura, anticipo',
  attack: 'Gol, gambeta, último pase',
  physical: 'Velocidad, aguante, fuerza',
}

export const RATING_SCALE_LABELS: Record<number, string> = {
  1: 'Flojo',
  2: 'Cumple',
  3: 'Bien',
  4: 'Muy bien',
  5: 'Crack',
}

// Tags are deliberately positive or neutral (no shaming): they describe what a player
// brings, and the team generator reads them as traits.
export const PLAYER_TAGS = [
  { key: 'fast', label: 'Rápido' },
  { key: 'strong', label: 'Fuerte' },
  { key: 'stamina', label: 'Resistente' },
  { key: 'technical', label: 'Técnico' },
  { key: 'scorer', label: 'Goleador' },
  { key: 'good_passer', label: 'Buen pase' },
  { key: 'marks_well', label: 'Marca bien' },
  { key: 'aerial', label: 'Juego aéreo' },
  { key: 'vision', label: 'Visión de juego' },
  { key: 'leader', label: 'Líder' },
  { key: 'hard_worker', label: 'Sacrificado' },
  { key: 'organized', label: 'Ordenado' },
  { key: 'can_keep', label: 'Puede atajar' },
] as const

export type PlayerTag = (typeof PLAYER_TAGS)[number]['key']

const TAG_LABELS: Record<string, string> = Object.fromEntries(
  PLAYER_TAGS.map((t) => [t.key, t.label])
)

export function tagLabel(key: string): string {
  return TAG_LABELS[key] ?? key
}

export const DEFAULT_OVERALL = 3

export interface PlayerSkills {
  goalkeeping: number
  defense: number
  attack: number
  physical: number
}

// Row shape of player_rating_summary as the app reads it.
export interface RatingSummary {
  player_id: string
  goalkeeping: number | null
  defense: number | null
  attack: number | null
  physical: number | null
  overall: number
  tags: string[]
  peer_votes: number
  matches_rated: number
}

export function summariesById(rows: RatingSummary[] | null | undefined): Map<string, RatingSummary> {
  return new Map((rows ?? []).map((r) => [r.player_id, r]))
}

export function skillsOf(summary: RatingSummary | undefined | null): PlayerSkills | null {
  if (
    !summary ||
    summary.goalkeeping === null ||
    summary.defense === null ||
    summary.attack === null ||
    summary.physical === null
  ) {
    return null
  }
  return {
    goalkeeping: summary.goalkeeping,
    defense: summary.defense,
    attack: summary.attack,
    physical: summary.physical,
  }
}

export function overallOf(summary: RatingSummary | undefined | null): number {
  return summary?.overall ?? DEFAULT_OVERALL
}
