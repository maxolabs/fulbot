'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CalendarPlus, ArrowUpCircle, Users, Clock, Goal, Bell, Star, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import { renderNotificationText } from '@/lib/notifications/templates'
import type { NotificationEvent, NotificationRow, RateNewMemberPayload } from '@/lib/notifications/types'
import { formatMatchTime } from '@/lib/utils/datetime'

interface NotificationItem extends NotificationRow {
  groupSlug: string | null
  groupName: string
  groupTimezone: string
  isRead: boolean
}

const TYPE_ICON: Record<NotificationRow['type'], LucideIcon> = {
  match_created: CalendarPlus,
  waitlist_promoted: ArrowUpCircle,
  teams_created: Users,
  match_reminder: Clock,
  results_posted: Goal,
  rate_new_member: Star,
}

// Date/month via Intl's default formatting is fine here (no AM/PM
// ambiguity); the hour/minute portion goes through formatMatchTime so it's
// always 24h and deterministic between server render and hydration.
function formatWhen(iso: string, timeZone: string): string {
  const dateOnly = new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(new Date(iso))
  return `${dateOnly} ${formatMatchTime(iso, timeZone)}`
}

function safeRenderText(item: NotificationItem): string {
  try {
    return renderNotificationText(
      { type: item.type, payload: item.payload } as unknown as NotificationEvent,
      item.groupTimezone
    )
  } catch {
    return ''
  }
}

export function NotificationList({
  items,
  prefs,
}: {
  items: NotificationItem[]
  prefs: Record<string, boolean>
}) {
  const supabase = createClient()
  // Read state comes from notification_reads (per-player), passed in as
  // isRead -- never from a shared column on the notification row itself, so
  // marking read here never affects other members' unread state for the
  // same group-wide notification.
  const [readIds, setReadIds] = useState<Set<string>>(
    () => new Set(items.filter((n) => n.isRead).map((n) => n.id))
  )
  const [marking, setMarking] = useState(false)

  // Respect users.notification_prefs client-side -- never filter in SQL
  // (see docs/rework-plan.md §2.6). match_created has no per-user toggle
  // (it's a group-level setting), so it's always shown.
  const visibleItems = items.filter((n) => prefs[n.type] !== false)
  const unreadIds = visibleItems.filter((n) => !readIds.has(n.id)).map((n) => n.id)

  const markAllRead = async () => {
    if (unreadIds.length === 0) return
    setMarking(true)
    try {
      const { error } = await supabase.rpc('mark_notifications_read', { p_ids: unreadIds })
      if (!error) {
        setReadIds((prev) => {
          const next = new Set(prev)
          unreadIds.forEach((id) => next.add(id))
          return next
        })
      }
    } finally {
      setMarking(false)
    }
  }

  if (visibleItems.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          <Bell className="h-8 w-8 mx-auto mb-3 opacity-50" />
          No tenés notificaciones todavía.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={markAllRead}
          disabled={marking || unreadIds.length === 0}
        >
          Marcar todo como leído
        </Button>
      </div>

      <div className="space-y-2">
        {visibleItems.map((n) => {
          const Icon = TYPE_ICON[n.type] ?? Bell
          const isRead = readIds.has(n.id)
          const href =
            n.type === 'rate_new_member' && n.groupSlug
              ? `/groups/${n.groupSlug}/rate?player=${(n.payload as RateNewMemberPayload).player_id}`
              : n.match_id && n.groupSlug
                ? `/groups/${n.groupSlug}/matches/${n.match_id}`
                : n.groupSlug
                  ? `/groups/${n.groupSlug}`
                  : null

          const card = (
            <Card className={isRead ? 'opacity-70' : 'border-primary/30'}>
              <CardContent className="py-4 flex items-start gap-3">
                <Icon className="h-5 w-5 mt-0.5 shrink-0 text-primary" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{safeRenderText(n)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {n.groupName ? `${n.groupName} · ` : ''}
                    {formatWhen(n.created_at, n.groupTimezone)}
                  </p>
                </div>
                {!isRead && <span className="h-2 w-2 rounded-full bg-primary mt-2 shrink-0" />}
              </CardContent>
            </Card>
          )

          return href ? (
            <Link key={n.id} href={href} className="block">
              {card}
            </Link>
          ) : (
            <div key={n.id}>{card}</div>
          )
        })}
      </div>
    </div>
  )
}
