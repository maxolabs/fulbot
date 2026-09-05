'use client'

import { useCallback } from 'react'
import { translate, getTranslation, type Language, type TranslationKeys } from './core'

export function useTranslations(language: Language = 'es') {
  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string =>
      translate(language, key, params),
    [language]
  )

  return { t, language }
}

// Re-exported for existing client importers. Server code must import from './core'
// or './server', never from this file.
export { getTranslation }
export type { Language, TranslationKeys }
