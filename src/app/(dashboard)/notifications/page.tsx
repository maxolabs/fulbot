import { createClient } from '@/lib/supabase/server'
import { NotificationList } from './notification-list'
import type { NotificationRow, RateNewMemberPayload } from '@/lib/notifications/types'
import { DEFAULT_TIMEZONE } from '@/lib/utils/datetime'

export default async function NotificationsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: userData } = await supabase
    .from('users')
    .select('notification_prefs')
    .eq('id', user.id)
    .single() as { data: { notification_prefs: Record<string, boolean> | null } | null }

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
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Notificaciones</h1>
        <p className="text-muted-foreground">Novedades de tus grupos</p>
      </div>

      <NotificationList items={items} prefs={prefs} currentPlayerId={playerProfile?.id ?? null} />
    </div>
  )
}
