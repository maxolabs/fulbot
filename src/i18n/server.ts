import { getTranslation, type Language } from './use-translations'

/**
 * Server-side translation helper. Use in Server Components / route handlers:
 *   const t = getT(language)
 *   t('matches.status.signup_open')
 */
export function getT(language: Language = 'es') {
  return getTranslation(language)
}

export type { Language }
