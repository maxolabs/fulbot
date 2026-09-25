import Link from 'next/link'
import { getT } from '@/i18n/server'
import { createClient } from '@/lib/supabase/server'
import { NotificationList } from './notification-list'
import type { NotificationRow } from '@/lib/notifications/types'
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
    .select('preferred_language')
    .eq('id', user.id)
    .single() as { data: { preferred_language: 'es' | 'en' } | null }

  const t = getT(userData?.preferred_language ?? 'es')

  const { data: playerProfile } = await supabase
    .from('player_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single() as { data: { id: string } | null }

  // list_my_notifications (00026) applies the same visibility rule as the
  // unread dot (get_unread_notification_count): the user's active groups,
  // their notification_prefs, the per-type audience (confirmed players,
  // pending reporters...) and their own read state.
  const { data: notifications } = await supabase.rpc('list_my_notifications', { p_limit: 100 })

  const rows = (notifications ?? []) as unknown as (NotificationRow & { is_read: boolean })[]
  const groupIds = Array.from(new Set(rows.map((n) => n.group_id)))

  const { data: groups } =
    groupIds.length > 0
      ? await supabase.from('groups').select('id, slug, name, timezone').in('id', groupIds)
      : { data: [] as { id: string; slug: string; name: string; timezone: string | null }[] }

  const groupById = new Map((groups ?? []).map((g) => [g.id, g]))

  const items = rows.map((n) => ({
    ...n,
    groupSlug: groupById.get(n.group_id)?.slug ?? null,
    groupName: groupById.get(n.group_id)?.name ?? '',
    groupTimezone: groupById.get(n.group_id)?.timezone ?? DEFAULT_TIMEZONE,
    isRead: n.is_read,
  }))

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <NotificationList
        items={items}
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
