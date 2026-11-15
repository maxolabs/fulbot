import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'
import type { ThemePreference } from './actions'
import { DeviceNotifications } from '@/components/device-notifications'
import { SettingsForm } from './settings-form'
import { AccountSection } from './account-section'
import { PageHeader } from '@/components/layout/page-header'
import { TopBarConfig } from '@/components/layout/top-bar'
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

  // "Borrar mi cuenta" is disabled, with the reason, while the user is the only
  // admin of a group that has other members (00033 refuses it as well).
  const { data: blockerRows } = playerProfile
    ? await supabase.rpc('account_deletion_blockers') as { data: { group_name: string }[] | null }
    : { data: [] as { group_name: string }[] }
  const deletionBlockers = (blockerRows ?? []).map((b) => b.group_name)

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
          <AccountSection
            email={user.email ?? ''}
            pendingEmail={user.new_email ?? null}
            deletionBlockers={deletionBlockers}
          />
        </CardContent>
      </Card>
    </div>
  )
}
