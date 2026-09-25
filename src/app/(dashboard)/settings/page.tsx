import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'
import type { ThemePreference } from './actions'
import { DeviceNotifications } from '@/components/device-notifications'
import { SettingsForm } from './settings-form'
import { PageHeader } from '@/components/layout/page-header'
import { TopBarConfig } from '@/components/layout/top-bar'

// Preferences (docs/ui-rework/03-screens.md §10): one column max-w-xl.
export default async function SettingsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  const { data: userData } = await supabase
    .from('users')
    .select('preferred_language, notification_prefs')
    .eq('id', user.id)
    .single() as { data: { preferred_language: Language; notification_prefs: Record<string, boolean> | null } | null }

  if (!userData) return notFound()

  const cookieStore = await cookies()
  const themeCookie = cookieStore.get('fulbot_theme')?.value
  const theme: ThemePreference =
    themeCookie === 'light' || themeCookie === 'dark' || themeCookie === 'system'
      ? themeCookie
      : 'dark'

  const t = getT(userData.preferred_language)
  const prefs = userData.notification_prefs || {}

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <TopBarConfig title={t('ui.shell.preferences')} back="/profile" />
      <PageHeader title={t('ui.shell.preferences')} subtitle={t('settings.subtitle')} />
      <p className="text-sm text-muted-foreground lg:hidden">{t('settings.subtitle')}</p>

      <DeviceNotifications />
      <SettingsForm
        initialLanguage={userData.preferred_language}
        initialTheme={theme}
        initialNotificationPrefs={{
          match_created: prefs.match_created ?? true,
          waitlist_promoted: prefs.waitlist_promoted ?? true,
          teams_created: prefs.teams_created ?? true,
          match_reminder: prefs.match_reminder ?? true,
          results_posted: prefs.results_posted ?? true,
          results_request: prefs.results_request ?? true,
          results_reminder: prefs.results_reminder ?? true,
        }}
      />
    </div>
  )
}
