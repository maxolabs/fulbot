import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { TopBarConfig } from '@/components/layout/top-bar'
import { PageHeader } from '@/components/layout/page-header'
import { buttonVariants } from '@/components/ui/button'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { GroupSettingsForm } from './settings-form'
import { MemberScoringSettingsCard } from './member-scoring-settings'
import type { Json } from '@/types/database'
import { MembersManager } from './members-manager'
import { NotificationSettings } from './notification-settings'
import { RecurringPatternForm } from './recurring-pattern-form'
import { DangerZone } from './danger-zone'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'

interface PageProps {
  params: Promise<{ groupSlug: string }>
}

// Group settings (docs/ui-rework/03-screens.md §9): one column of dashed
// cards in today's order; the danger zone is the one solid, destructive
// outline on the page.

export default async function GroupSettingsPage({ params }: PageProps) {
  const { groupSlug } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  const { data: userData } = await supabase
    .from('users')
    .select('preferred_language')
    .eq('id', user.id)
    .single() as { data: { preferred_language: Language } | null }

  const t = getT(userData?.preferred_language ?? 'es')

  const { data: playerProfile } = await supabase
    .from('player_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single() as { data: { id: string } | null }

  if (!playerProfile) return notFound()

  const { data: group } = await supabase
    .from('groups')
    .select('*')
    .eq('slug', groupSlug)
    .single() as { data: {
      id: string
      name: string
      slug: string
      description: string | null
      default_match_day: number | null
      default_match_time: string | null
      default_max_players: number
      invite_code: string
      timezone: string
      settings: Json | null
    } | null }

  if (!group) return notFound()

  const { data: membership } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('group_id', group.id)
    .eq('player_id', playerProfile.id)
    .eq('is_active', true)
    .single() as { data: { role: string } | null }

  if (!membership || membership.role !== 'admin') {
    redirect(`/groups/${groupSlug}`)
  }

  type MembershipWithProfile = {
    id: string
    role: string
    is_active: boolean
    player_profiles: {
      id: string
      display_name: string
      user_id: string | null
    } | null
  }

  const { data: memberships } = await supabase
    .from('group_memberships')
    .select(`
      id,
      role,
      is_active,
      player_profiles (
        id,
        display_name,
        user_id
      )
    `)
    .eq('group_id', group.id)
    .eq('is_active', true)
    .order('role') as { data: MembershipWithProfile[] | null }

  const members = (memberships || [])
    .filter((m) => m.player_profiles !== null)
    .map((m) => ({
      membershipId: m.id,
      role: m.role as 'admin' | 'captain' | 'member',
      playerId: (m.player_profiles as { id: string }).id,
      displayName: (m.player_profiles as { display_name: string }).display_name,
      userId: (m.player_profiles as { user_id: string | null }).user_id,
      isCurrentUser: (m.player_profiles as { user_id: string | null }).user_id === user.id,
    }))

  type NotificationSettingsType = {
    id: string
    send_signup_link_on_create: boolean
    reminder_hours_before: number
    notify_on_waitlist_promotion: boolean
    notify_on_teams_created: boolean
    whatsapp_webhook_url: string | null
    default_duration_minutes: number
    default_results_request_delay_minutes: number
    results_reminder_hours: number
    results_window_days: number
  }

  const { data: notificationSettings } = await supabase
    .from('notification_settings')
    .select('*')
    .eq('group_id', group.id)
    .single() as { data: NotificationSettingsType | null }

  const notifSettings = notificationSettings
    ? {
        ...notificationSettings,
        // Rows created before 00018 come back without these columns until the
        // migration is applied; keep the inputs controlled with the same
        // defaults the migration uses.
        default_duration_minutes: notificationSettings.default_duration_minutes ?? 60,
        default_results_request_delay_minutes:
          notificationSettings.default_results_request_delay_minutes ?? 60,
        results_reminder_hours: notificationSettings.results_reminder_hours ?? 24,
        results_window_days: notificationSettings.results_window_days ?? 7,
      }
    : {
        id: null,
        send_signup_link_on_create: true,
        reminder_hours_before: 3,
        notify_on_waitlist_promotion: true,
        notify_on_teams_created: true,
        whatsapp_webhook_url: null,
        default_duration_minutes: 60,
        default_results_request_delay_minutes: 60,
        results_reminder_hours: 24,
        results_window_days: 7,
      }

  // Recurring pattern (one per group; UI creates/edits/deactivates it)
  const { data: recurringPattern } = await supabase
    .from('recurring_patterns')
    .select('id, weekday, match_time, location, max_players, signup_opens_weekday, signup_opens_time, timezone, is_active')
    .eq('group_id', group.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <TopBarConfig title={t('ui.shell.groupSettings')} back={`/groups/${groupSlug}`} />

      <PageHeader title={t('ui.shell.groupSettings')} subtitle={group.name} />
      <Eyebrow className="lg:hidden">{group.name}</Eyebrow>

      <Card>
        <CardHeader>
          <CardTitle>{t('ui.screens.groupSettings.general')}</CardTitle>
          <CardDescription>{t('ui.screens.groupSettings.generalHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <GroupSettingsForm group={group} />
        </CardContent>
      </Card>

      {/* Member scoring (docs/member-scoring.md §6, §10.2) */}
      <Card>
        <CardHeader>
          <CardTitle>{t('memberScoring.settings.title')}</CardTitle>
          <CardDescription>{t('memberScoring.settings.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <MemberScoringSettingsCard groupId={group.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <CardTitle>{t('ui.screens.groupSettings.members', { n: members.length })}</CardTitle>
              <CardDescription>{t('ui.screens.groupSettings.membersHint')}</CardDescription>
            </div>
            <Link
              href={`/groups/${groupSlug}/rate?mode=baseline`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <ClipboardList className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              {t('ui.screens.players.baselineCta')}
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <MembersManager
            groupId={group.id}
            members={members}
            currentUserId={user.id}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('ui.screens.groupSettings.notifications')}</CardTitle>
          <CardDescription>{t('ui.screens.groupSettings.notificationsHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationSettings
            groupId={group.id}
            settings={notifSettings}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('ui.screens.groupSettings.recurring')}</CardTitle>
          <CardDescription>{t('ui.screens.groupSettings.recurringHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <RecurringPatternForm
            groupId={group.id}
            groupDefaults={{
              default_match_day: group.default_match_day,
              default_match_time: group.default_match_time,
              default_max_players: group.default_max_players,
              timezone: group.timezone,
            }}
            pattern={recurringPattern}
          />
        </CardContent>
      </Card>

      <Card variant="solid" className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">{t('ui.screens.groupSettings.danger')}</CardTitle>
          <CardDescription>{t('ui.screens.groupSettings.dangerHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <DangerZone groupId={group.id} groupName={group.name} />
        </CardContent>
      </Card>
    </div>
  )
}
