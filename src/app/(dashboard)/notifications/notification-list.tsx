'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  CalendarPlus,
  ArrowUpCircle,
  Users,
  Clock,
  Goal,
  Bell,
  CheckCheck,
  ClipboardList,
  AlarmClock,
  AlertCircle,
  Star,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/page-header'
import { TopBarAction, useTopBar } from '@/components/layout/top-bar'
import { useShell } from '@/components/layout/shell-context'
import { createClient } from '@/lib/supabase/client'
import { renderNotificationText } from '@/lib/notifications/templates'
import type { NotificationEvent, NotificationRow, RateNewMemberPayload } from '@/lib/notifications/types'
import { formatMatchDayMonth, formatMatchTime } from '@/lib/utils/datetime'
import { useT } from '@/i18n/provider'
import { cn } from '@/lib/utils/cn'

// Notification rows (docs/ui-rework/03-screens.md §10, 06-principles.md §9):
// mono time on the right, and an unread row carries both the 6px cone dot
// and a bold title, so colour is never the only carrier.

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
  results_request: ClipboardList,
  results_reminder: AlarmClock,
  results_needs_review: AlertCircle,
  results_changed: RefreshCw,
  member_score_dropped: TrendingDown,
  member_score_recovered: TrendingUp,
}

// Types whose natural landing spot is the report form on the match page
// (docs/match-results-consensus.md §11.2), not the top of the page.
const REPORT_ANCHOR_TYPES = new Set<NotificationRow['type']>(['results_request', 'results_reminder'])

// results_reminder is one group-wide row per match carrying the ids of the
// players who still haven't reported; everyone else already did their part
// and shouldn't see it. Without a player id (no profile yet) hide it too.
//
// results_request is group-wide too; since the payload carries player_ids (the
// confirmed players) only they see it. Rows without the field predate it and
// stay visible to everyone.
function isVisibleTo(item: NotificationItem, currentPlayerId: string | null): boolean {
  if (item.type === 'results_reminder') {
    const pending = (item.payload as { pending_player_ids?: unknown }).pending_player_ids
    if (!Array.isArray(pending)) return false
    return currentPlayerId !== null && pending.includes(currentPlayerId)
  }
  if (item.type === 'results_request') {
    const players = (item.payload as { player_ids?: unknown }).player_ids
    if (!Array.isArray(players)) return true
    return currentPlayerId !== null && players.includes(currentPlayerId)
  }
  return true
}

function safeRenderText(item: NotificationItem): string {
  try {
    return renderNotificationText(
      { type: item.type, payload: item.payload } as unknown as NotificationEvent,
      item.groupTimezone,
      { channel: 'inapp' }
    )
  } catch {
    return ''
  }
}

export function NotificationList({
  items,
  prefs,
  currentPlayerId = null,
  extraActions,
}: {
  items: NotificationItem[]
  prefs: Record<string, boolean>
  currentPlayerId?: string | null
  extraActions?: React.ReactNode
}) {
  const t = useT()
  const shell = useShell()
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
  // including the signup-opened preference, also used by device push.
  const visibleItems = items.filter((n) => prefs[n.type] !== false && isVisibleTo(n, currentPlayerId))
  const unreadIds = visibleItems.filter((n) => !readIds.has(n.id)).map((n) => n.id)
  const canMark = !marking && unreadIds.length > 0

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
        shell?.setUnreadCount(0)
      }
    } finally {
      setMarking(false)
    }
  }

  const title = t('ui.shell.notifications')
  const markLabel = t('ui.screens.notifications.markAllRead')

  // Mobile top bar: title + the "mark all read" icon action.
  const topBarAction = useMemo(
    () =>
      canMark ? (
        <TopBarAction onClick={markAllRead} label={markLabel}>
          <CheckCheck className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
        </TopBarAction>
      ) : undefined,
    // markAllRead changes identity every render; the visible inputs are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canMark, markLabel, unreadIds.join(',')]
  )
  useTopBar({ title, action: topBarAction })

  return (
    <>
      <PageHeader
        title={title}
        subtitle={t('ui.screens.notifications.subtitle')}
        actions={
          <>
            {extraActions}
            <Button variant="outline" size="sm" onClick={markAllRead} disabled={!canMark}>
              <CheckCheck className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              {markLabel}
            </Button>
          </>
        }
      />

      {visibleItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('ui.screens.notifications.empty')}</p>
      ) : (
        <ul className="[&>li:last-child>*]:border-b-0">
          {visibleItems.map((n) => {
            const Icon = TYPE_ICON[n.type] ?? Bell
            const isRead = readIds.has(n.id)
            const anchor = REPORT_ANCHOR_TYPES.has(n.type) ? '#reportar' : ''
            // Score nudges are addressed to one member and land on their own
            // player page in that group (docs/member-scoring.md §10.4).
            const isScoreNudge = n.type === 'member_score_dropped' || n.type === 'member_score_recovered'
            const ownPlayerId = n.recipient_player_id ?? currentPlayerId
            const href =
              isScoreNudge && n.groupSlug && ownPlayerId
                ? `/groups/${n.groupSlug}/players/${ownPlayerId}`
                : n.type === 'rate_new_member' && n.groupSlug
                  ? `/groups/${n.groupSlug}/rate?player=${(n.payload as RateNewMemberPayload).player_id}`
                  : n.match_id && n.groupSlug
                    ? `/groups/${n.groupSlug}/matches/${n.match_id}${anchor}`
                    : n.groupSlug
                      ? `/groups/${n.groupSlug}`
                      : null

            const rowClassName = cn(
              'flex min-h-11 w-full items-start gap-3 border-b border-border py-3 text-left',
              href &&
                'hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
            )

            const content = (
              <>
                <span className="flex w-3 shrink-0 justify-center pt-[7px]" aria-hidden="true">
                  {!isRead && <span className="block h-1.5 w-1.5 rounded-full bg-primary" />}
                </span>
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm text-pretty', !isRead && 'font-semibold')}>
                    {!isRead && <span className="sr-only">{t('ui.screens.notifications.unread')} </span>}
                    {safeRenderText(n)}
                  </span>
                  {n.groupName && <span className="mt-0.5 block text-xs text-muted-foreground">{n.groupName}</span>}
                </span>
                <span className="shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                  <span className="block">{formatMatchDayMonth(n.created_at, n.groupTimezone)}</span>
                  <span className="block">{formatMatchTime(n.created_at, n.groupTimezone)}</span>
                </span>
              </>
            )

            return (
              <li key={n.id}>
                {href ? (
                  <Link href={href} className={rowClassName}>
                    {content}
                  </Link>
                ) : (
                  <div className={rowClassName}>{content}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
