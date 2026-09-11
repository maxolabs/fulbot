// Fixed brand colours that are NOT themed (docs/ui-rework/01-brand.md §1,
// 06-principles.md §6). These are the only hex literals allowed in .tsx, and
// they must be imported from here: the pitch, the lineup export route and the
// icons script all read the same values.

/** Team "Oscuras": lineup dots, team headers, export image. */
export const TEAM_DARK = '#1C1C1E'
/** Team "Claras": lineup dots, team headers, export image. */
export const TEAM_LIGHT = '#F3F0E6'
/** Text on a TEAM_LIGHT surface. */
export const TEAM_LIGHT_INK = '#1B1F2A'
/** The pitch ground, in both themes: the pitch is always a board. */
export const PITCH = '#173129'
/** Chalk line for pitch markings (dashed). */
export const CHALK = 'rgba(243,240,230,.75)'
/** Cone orange, the single primary colour. */
export const CONE = '#FF8A3D'
/** Dark ink used on top of cone orange. */
export const INK = '#1A1A1A'
/** The board itself (background in dark, PWA theme colour, public frames). */
export const BOARD = '#173129'
