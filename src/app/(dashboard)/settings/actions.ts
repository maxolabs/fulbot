'use server'

import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import type { Language } from '@/i18n/core'
import type { Json } from '@/types/database'

export type ThemePreference = 'light' | 'dark' | 'system'

export interface NotificationPrefsInput {
  match_created: boolean
  waitlist_promoted: boolean
  teams_created: boolean
  match_reminder: boolean
  results_posted: boolean
  results_request: boolean
  results_reminder: boolean
}

export interface SaveSettingsInput {
  language: Language
  theme: ThemePreference
  notificationPrefs: NotificationPrefsInput
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

// Error codes, not user-facing text: the settings form maps them to i18n keys.
export type SaveSettingsResult = { error: 'not_authenticated' | null }

export async function saveSettings(input: SaveSettingsInput): Promise<SaveSettingsResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'not_authenticated' }
  }

  const { error } = await supabase
    .from('users')
    .update({
      preferred_language: input.language,
      notification_prefs: { ...input.notificationPrefs } as unknown as Json,
    })
    .eq('id', user.id)

  if (error) {
    throw error
  }

  const cookieStore = await cookies()
  cookieStore.set('fulbot_theme', input.theme, {
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
    sameSite: 'lax',
  })
  cookieStore.set('fulbot_lang', input.language, {
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
    sameSite: 'lax',
  })

  return { error: null }
}
