'use client'

import { useCallback } from 'react'
import es from './es.json'
import en from './en.json'

type Language = 'es' | 'en'

const translations = { es, en }

type TranslationKeys = typeof es

function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const keys = path.split('.')
  let current: unknown = obj

  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = (current as Record<string, unknown>)[key]
    } else {
      return path // Return the path if translation not found
    }
  }

  return typeof current === 'string' ? current : path
}

export function useTranslations(language: Language = 'es') {
  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      let value = getNestedValue(translations[language], key)

      if (params) {
        Object.entries(params).forEach(([paramKey, paramValue]) => {
          value = value.replace(`{${paramKey}}`, String(paramValue))
        })
      }

      return value
    },
    [language]
  )

  return { t, language }
}

// Server-side translation function
export function getTranslation(language: Language = 'es') {
  return function t(key: string, params?: Record<string, string | number>): string {
    let value = getNestedValue(translations[language], key)

    if (params) {
      Object.entries(params).forEach(([paramKey, paramValue]) => {
        value = value.replace(`{${paramKey}}`, String(paramValue))
      })
    }

    return value
  }
}

export type { Language, TranslationKeys }
