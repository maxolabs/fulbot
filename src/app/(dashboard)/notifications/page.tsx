import { createClient } from '@/lib/supabase/server'
import { NotificationList } from './notification-list'
import type { NotificationRow } from '@/lib/notifications/types'

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

  // RLS scopes this to the current player's visible rows (their groups,
  // recipient_player_id null or their own) -- see 00012_notifications.sql.
  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, group_id, match_id, recipient_player_id, type, payload, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(100) as { data: NotificationRow[] | null }

  const rows = notifications ?? []
  const groupIds = Array.from(new Set(rows.map((n) => n.group_id)))

  const { data: groups } =
    groupIds.length > 0
      ? await supabase.from('groups').select('id, slug, name').in('id', groupIds)
      : { data: [] as { id: string; slug: string; name: string }[] }

  const groupById = new Map((groups ?? []).map((g) => [g.id, g]))

  const items = rows.map((n) => ({
    ...n,
    groupSlug: groupById.get(n.group_id)?.slug ?? null,
    groupName: groupById.get(n.group_id)?.name ?? '',
  }))

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Notificaciones</h1>
        <p className="text-muted-foreground">Novedades de tus grupos</p>
      </div>

      <NotificationList items={items} prefs={prefs} />
    </div>
  )
}
