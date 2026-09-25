/**
 * Initials for an avatar, a pitch dot or the export image: the first letter of
 * the first word plus the first letter of the last one, so "Martín Herrera"
 * reads "MH" and not "MA". A single word falls back to its first two letters
 * ("Nico" → "NI"). Shared by `Avatar`, `Pitch` and the lineup export route so
 * the same player is labelled identically everywhere (01-brand §6).
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}
