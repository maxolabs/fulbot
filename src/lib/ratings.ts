// Initial scoring: shared vocabulary for peer ratings (see migrations 00018_peer_ratings.sql
// and 00035_teams_ratings_privacy.sql).
//
// Peers rate each other per group on four 1-5 dimensions plus structured tags. The
// database aggregates everything into player_rating_summary, one row per (group, player)
// built from that group's peer ratings and post-match ratings only (OD-9), readable only
// by the group's admins and captains. Every reader filters on the current group
// (`.eq('group_id', groupId)`): a player in two groups has two independent rows. The
// pieces below are what the rating form, the score displays and the team generator
// agree on.

export const RATING_DIMENSIONS = ['goalkeeping', 'defense', 'attack', 'physical'] as const
export type RatingDimension = (typeof RATING_DIMENSIONS)[number]

// The Spanish constants below are the canonical vocabulary: the team generator
// prompt (src/lib/ai) reads them and must stay stable. Screens translate with
// the ui.ratings.* keys through the helpers at the end of this block, which use
// the same stable ids (dimension names, 1-5, tag keys).

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

type Translate = (key: string, params?: Record<string, string | number>) => string

export function dimensionLabel(t: Translate, dim: RatingDimension): string {
  return t(`ui.ratings.dimensions.${dim}`)
}

export function dimensionShort(t: Translate, dim: RatingDimension): string {
  return t(`ui.ratings.short.${dim}`)
}

export function dimensionHint(t: Translate, dim: RatingDimension): string {
  return t(`ui.ratings.hints.${dim}`)
}

export function scaleLabel(t: Translate, value: number): string {
  return t(`ui.ratings.scale.${value}`)
}

// Unknown tag keys (stored before a tag was renamed) fall back to the raw key,
// like tagLabel.
export function translatedTagLabel(t: Translate, key: string): string {
  const path = `ui.ratings.tags.${key}`
  const label = t(path)
  return label === path ? tagLabel(key) : label
}

export const DEFAULT_OVERALL = 3

export interface PlayerSkills {
  goalkeeping: number
  defense: number
  attack: number
  physical: number
}

// Columns every reader selects from player_rating_summary (always with
// `.eq('group_id', …)`, see the header).
export const RATING_SUMMARY_COLUMNS =
  'player_id, goalkeeping, defense, attack, physical, overall, tags, peer_votes, matches_rated' as const

// Row shape of player_rating_summary as the app reads it (one group's row).
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
