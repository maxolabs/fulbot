import type { Language } from '@/i18n/core'

// Client-side write of the fulbot_lang cookie, which the public pages and the
// root layout's <html lang> read. Same attributes as settings/actions.ts.
export function setLanguageCookie(language: Language) {
  if (typeof document === 'undefined') return
  document.cookie = `fulbot_lang=${language}; path=/; max-age=31536000; samesite=lax`
}
