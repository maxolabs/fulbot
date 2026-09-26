'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  CalendarPlus,
  CalendarX,
  CalendarClock,
  UserMinus,
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
import { useLanguage, useT, type Language } from '@/i18n/provider'
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
  match_cancelled: CalendarX,
  match_updated: CalendarClock,
  lineup_changed: UserMinus,
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

function safeRenderText(item: NotificationItem, language: Language): string {
  try {
    return renderNotificationText(
      { type: item.type, payload: item.payload } as unknown as NotificationEvent,
      item.groupTimezone,
      { channel: 'inapp', language, now: new Date(item.created_at) }
    )
  } catch {
    return ''
  }
}

export function NotificationList({
  items,
  currentPlayerId = null,
  extraActions,
}: {
  items: NotificationItem[]
  currentPlayerId?: string | null
  extraActions?: React.ReactNode
}) {
  const t = useT()
  const language = useLanguage()
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

  // Visibility (prefs, audience, "already reported") is decided in SQL by
  // list_my_notifications, the same rule the unread dot uses (00026).
  const unreadIds = items.filter((n) => !readIds.has(n.id)).map((n) => n.id)
  const canMark = !marking && unreadIds.length > 0

  const markAllRead = async () => {
    if (unreadIds.length === 0) return
    setMarking(true)
    try {
      // Marks every visible row, including older ones past the loaded page.
      const { error } = await supabase.rpc('mark_all_notifications_read')
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

  // Opening a notification marks it read (fire and forget: navigation must
  // not wait for it, and a failure only leaves the dot on).
  const markOneRead = (id: string) => {
    if (readIds.has(id)) return
    setReadIds((prev) => new Set(prev).add(id))
    if (shell) shell.setUnreadCount(Math.max(0, shell.unreadCount - 1))
    void supabase.rpc('mark_notifications_read', { p_ids: [id] }).then(({ error }) => {
      if (error) console.error('Error marking notification read:', error)
    })
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

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('ui.screens.notifications.empty')}</p>
      ) : (
        <ul className="[&>li:last-child>*]:border-b-0">
          {items.map((n) => {
            const Icon = TYPE_ICON[n.type] ?? Bell
            const isRead = readIds.has(n.id)
            const anchor = REPORT_ANCHOR_TYPES.has(n.type) ? '#reportar' : n.type === 'lineup_changed' ? '/teams' : ''
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
                    {safeRenderText(n, language)}
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
                  <Link href={href} className={rowClassName} onClick={() => markOneRead(n.id)}>
                    {content}
                  </Link>
                ) : (
                  <button type="button" className={rowClassName} onClick={() => markOneRead(n.id)}>
                    {content}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
