import { cookies } from 'next/headers'
import type { Language } from '@/i18n/core'

/** The public pages' language: the fulbot_lang cookie, Spanish by default. */
export async function publicLanguage(): Promise<Language> {
  const cookieStore = await cookies()
  return cookieStore.get('fulbot_lang')?.value === 'en' ? 'en' : 'es'
}
