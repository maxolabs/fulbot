import Link from 'next/link'
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
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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

  // lineup_changed only reaches admins and captains (00030), so only they
  // get its toggle.
  const { data: playerProfile } = await supabase
    .from('player_profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle() as { data: { id: string } | null }
  const { data: staffRoles } = playerProfile
    ? await supabase
        .from('group_memberships')
        .select('role')
        .eq('player_id', playerProfile.id)
        .eq('is_active', true)
        .in('role', ['admin', 'captain'])
        .limit(1)
    : { data: [] as { role: string }[] }
  const isStaff = (staffRoles ?? []).length > 0

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
          match_cancelled: prefs.match_cancelled ?? true,
          match_updated: prefs.match_updated ?? true,
          lineup_changed: prefs.lineup_changed ?? true,
          results_posted: prefs.results_posted ?? true,
          results_request: prefs.results_request ?? true,
          results_reminder: prefs.results_reminder ?? true,
        }}
        showStaffPrefs={isStaff}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('ui.screens.preferences.accountTitle')}</CardTitle>
          <CardDescription>{t('ui.screens.preferences.accountDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="[&>li:last-child]:border-b-0">
            <li className="flex min-h-11 items-center justify-between gap-4 border-b border-border py-3">
              <span className="text-sm font-medium">{t('ui.screens.preferences.accountEmail')}</span>
              <span className="min-w-0 truncate text-sm text-muted-foreground">{user.email}</span>
            </li>
            <li className="flex min-h-11 items-center justify-end border-b border-border py-3">
              <Button asChild variant="outline" size="sm">
                <Link href="/update-password?redirect=/settings">{t('ui.screens.preferences.changePassword')}</Link>
              </Button>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
