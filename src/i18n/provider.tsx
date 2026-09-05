'use client'

import { createContext, useContext, useMemo } from 'react'
import { useTranslations, type Language } from './use-translations'

const LanguageContext = createContext<Language>('es')

export function LanguageProvider({
  language,
  children,
}: {
  language: Language
  children: React.ReactNode
}) {
  return (
    <LanguageContext.Provider value={language}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage(): Language {
  return useContext(LanguageContext)
}

/**
 * Client-side translation hook. Reads the language from the nearest
 * <LanguageProvider> up the tree (defaults to 'es' if none is present).
 */
export function useT() {
  const language = useContext(LanguageContext)
  const { t } = useTranslations(language)
  return useMemo(() => t, [t])
}

export type { Language }
