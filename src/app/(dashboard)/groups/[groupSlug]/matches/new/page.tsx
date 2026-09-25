import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TopBarConfig } from '@/components/layout/top-bar'
import { PageHeader } from '@/components/layout/page-header'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'
import { CreateMatchForm } from './create-match-form'
import { DEFAULT_TIMEZONE, splitDateTimeInTimezone, weekdayIndexInTimezone } from '@/lib/utils/datetime'

interface PageProps {
  params: Promise<{ groupSlug: string }>
}

export default async function CreateMatchPage({ params }: PageProps) {
  const { groupSlug } = await params
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  const { data: userData } = await supabase
    .from('users')
    .select('preferred_language')
    .eq('id', user.id)
    .single() as { data: { preferred_language: Language } | null }
  const t = getT(userData?.preferred_language ?? 'es')

  // Get user's player profile
  const { data: playerProfile } = await supabase
    .from('player_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single() as { data: { id: string } | null }

  if (!playerProfile) return notFound()

  // Get group
  const { data: group } = await supabase
    .from('groups')
    .select('id, name, slug, default_match_day, default_match_time, default_max_players, timezone')
    .eq('slug', groupSlug)
    .single() as { data: {
      id: string
      name: string
      slug: string
      default_match_day: number | null
      default_match_time: string | null
      default_max_players: number
      timezone: string
    } | null }

  if (!group) return notFound()

  // Creating matches is admin-only (matches INSERT policy); captains manage
  // existing matches but can't create them.
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

  // Group defaults for the scheduler fields (00019); fall back when the row is missing.
  const { data: notifDefaults } = await supabase
    .from('notification_settings')
    .select('default_duration_minutes, default_results_request_delay_minutes')
    .eq('group_id', group.id)
    .maybeSingle() as { data: { default_duration_minutes: number | null; default_results_request_delay_minutes: number | null } | null }
  const durationMinutes = notifDefaults?.default_duration_minutes ?? 60
  const resultsRequestDelayMinutes = notifDefaults?.default_results_request_delay_minutes ?? 60

  // Next default_match_day at default_match_time, computed on the group's wall
  // clock: the server runs in UTC, so getDay()/setHours() would pick the wrong
  // day around midnight.
  const getNextMatchDate = () => {
    const timeZone = group.timezone || DEFAULT_TIMEZONE
    const now = new Date()
    const today = splitDateTimeInTimezone(now.toISOString(), timeZone)
    const targetDay = group.default_match_day ?? 1 // Default to Monday
    let daysUntilTarget = (targetDay - weekdayIndexInTimezone(now, timeZone) + 7) % 7

    // If target day is today and it's past the default time, go to next week
    const defaultTime = (group.default_match_time || '21:00').slice(0, 5)
    if (daysUntilTarget === 0 && today.time > defaultTime) {
      daysUntilTarget = 7
    }

    // Calendar arithmetic on the local date only (UTC midnight, no DST shifts).
    const [year, month, day] = today.date.split('-').map(Number)
    return new Date(Date.UTC(year, month - 1, day + daysUntilTarget)).toISOString().split('T')[0]
  }

  const title = t('ui.matchScreens.forms.createMatch')
  const subtitle = t('ui.matchScreens.forms.createMatchSubtitle', { group: group.name })

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <TopBarConfig title={title} back={`/groups/${groupSlug}`} />
      <PageHeader title={title} subtitle={subtitle} />
      <p className="text-sm text-muted-foreground text-pretty lg:hidden">{subtitle}</p>

      <CreateMatchForm
        groupId={group.id}
        groupSlug={group.slug}
        timezone={group.timezone}
        defaults={{
          date: getNextMatchDate(),
          time: group.default_match_time?.slice(0, 5) || '21:00',
          maxPlayers: group.default_max_players,
          durationMinutes,
          resultsRequestDelayMinutes,
        }}
      />
    </div>
  )
}
