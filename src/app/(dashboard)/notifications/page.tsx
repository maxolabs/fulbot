import Link from 'next/link'
import { getT } from '@/i18n/server'
import { createClient } from '@/lib/supabase/server'
import { NotificationList } from './notification-list'
import type { NotificationRow, RateNewMemberPayload } from '@/lib/notifications/types'
import { DEFAULT_TIMEZONE } from '@/lib/utils/datetime'

// Notifications (docs/ui-rework/03-screens.md §10). The list component owns
// the read state, so it also renders the page header and the top-bar action
// ("Marcar todo como leído" in both shells).
export default async function NotificationsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: userData } = await supabase
    .from('users')
    .select('notification_prefs, preferred_language')
    .eq('id', user.id)
    .single() as { data: { notification_prefs: Record<string, boolean> | null; preferred_language: 'es' | 'en' } | null }

  const t = getT(userData?.preferred_language ?? 'es')
  const prefs = (userData?.notification_prefs ?? {}) as Record<string, boolean>

  const { data: playerProfile } = await supabase
    .from('player_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single() as { data: { id: string } | null }

  // RLS scopes this to the current player's visible rows (their groups,
  // recipient_player_id null or their own) -- see 00012_notifications.sql.
  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, group_id, match_id, recipient_player_id, type, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(100) as { data: NotificationRow[] | null }

  // A "rate the new member" nudge is for everyone except the new member.
  const rows = (notifications ?? []).filter(
    (n) =>
      !(
        n.type === 'rate_new_member' &&
        (n.payload as RateNewMemberPayload).player_id === playerProfile?.id
      )
  )
  const groupIds = Array.from(new Set(rows.map((n) => n.group_id)))

  const { data: groups } =
    groupIds.length > 0
      ? await supabase.from('groups').select('id, slug, name, timezone').in('id', groupIds)
      : { data: [] as { id: string; slug: string; name: string; timezone: string | null }[] }

  const groupById = new Map((groups ?? []).map((g) => [g.id, g]))

  // Read state is per-(notification, player) -- see notification_reads in
  // 00012_notifications.sql -- so it never leaks across group members
  // sharing a group-wide row (match_created, teams_created, results_posted).
  const { data: reads } =
    playerProfile && rows.length > 0
      ? await supabase
          .from('notification_reads')
          .select('notification_id')
          .eq('player_id', playerProfile.id)
          .in('notification_id', rows.map((n) => n.id))
      : { data: [] as { notification_id: string }[] }

  const readIds = new Set((reads ?? []).map((r) => r.notification_id))

  const items = rows.map((n) => ({
    ...n,
    groupSlug: groupById.get(n.group_id)?.slug ?? null,
    groupName: groupById.get(n.group_id)?.name ?? '',
    groupTimezone: groupById.get(n.group_id)?.timezone ?? DEFAULT_TIMEZONE,
    isRead: readIds.has(n.id),
  }))

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <NotificationList
        items={items}
        prefs={prefs}
        currentPlayerId={playerProfile?.id ?? null}
        extraActions={
          <Link href="/settings" className="inline-flex min-h-11 items-center text-sm font-medium text-foreground underline underline-offset-4 hover:text-primary lg:min-h-9">
            {t('devicePush.inboxLink')}
          </Link>
        }
      />
    </div>
  )
}
