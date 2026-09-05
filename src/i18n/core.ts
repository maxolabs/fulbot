// Pure translation logic shared by server and client code.
// This module must NOT carry a 'use client' directive: server components import
// getTranslation from here, and a client-module export would arrive on the server
// as a client reference instead of a callable function.
import es from './es.json'
import en from './en.json'

export type Language = 'es' | 'en'
export type TranslationKeys = typeof es
export type TranslateFn = (key: string, params?: Record<string, string | number>) => string

const translations: Record<Language, Record<string, unknown>> = { es, en }

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

export function translate(
  language: Language,
  key: string,
  params?: Record<string, string | number>
): string {
  let value = getNestedValue(translations[language] ?? translations.es, key)

  if (params) {
    Object.entries(params).forEach(([paramKey, paramValue]) => {
      value = value.replace(`{${paramKey}}`, String(paramValue))
    })
  }

  return value
}

export function getTranslation(language: Language = 'es'): TranslateFn {
  return (key, params) => translate(language, key, params)
}
