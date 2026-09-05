import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'
import type { ThemePreference } from './actions'
import { SettingsForm } from './settings-form'

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
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('settings.title')}</h1>
        <p className="text-muted-foreground">{t('settings.subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.title')}</CardTitle>
          <CardDescription>{t('settings.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm
            initialLanguage={userData.preferred_language}
            initialTheme={theme}
            initialNotificationPrefs={{
              waitlist_promoted: prefs.waitlist_promoted ?? true,
              teams_created: prefs.teams_created ?? true,
              match_reminder: prefs.match_reminder ?? true,
              results_posted: prefs.results_posted ?? true,
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
