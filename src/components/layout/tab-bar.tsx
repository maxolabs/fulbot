'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarCheck, CircleUser, Users } from 'lucide-react'
import { useT } from '@/i18n/provider'
import { cn } from '@/lib/utils/cn'
import { useShell } from './shell-context'
import type { ShellCurrentGroup } from './types'

// Mobile tab bar (docs/ui-rework/02-shell.md §2): Partido / Grupo / Yo. The
// active tab's icon is the one orange element of the chrome and its label is
// bold chalk (cone text on paper is 2.5:1, below the 4.5:1 floor). Hidden on
// routes that end in /new or /edit (full-height forms). `currentGroup` comes
// from the fulbot_group cookie; without one, both group tabs go to /groups.

export interface TabBarProps {
  currentGroup?: ShellCurrentGroup
  unread: boolean
  className?: string
}

const HIDDEN_ROUTE = /\/(new|edit)$/

export function isTabBarHidden(pathname: string): boolean {
  return HIDDEN_ROUTE.test(pathname)
}

export function TabBar({ currentGroup, unread: unreadProp, className }: TabBarProps) {
  const t = useT()
  const pathname = usePathname()
  const shell = useShell()
  const unread = shell ? shell.unreadCount > 0 : unreadProp

  if (isTabBarHidden(pathname)) return null

  const groupBase = currentGroup ? `/groups/${currentGroup.slug}` : null
  const matchHref = groupBase
    ? currentGroup?.nextMatchId
      ? `${groupBase}/matches/${currentGroup.nextMatchId}`
      : `${groupBase}/matches`
    : '/groups'
  const groupHref = groupBase ?? '/groups'

  const inMatches = /^\/groups\/[^/]+\/matches(\/|$)/.test(pathname)
  const inGroups = pathname === '/groups' || pathname.startsWith('/groups/')
  const inMe = ['/profile', '/settings', '/notifications'].some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  )

  const tabs = [
    { href: matchHref, label: t('ui.shell.tabMatch'), Icon: CalendarCheck, active: inMatches, dot: false },
    { href: groupHref, label: t('ui.shell.tabGroup'), Icon: Users, active: inGroups && !inMatches, dot: false },
    { href: '/profile', label: t('ui.shell.tabMe'), Icon: CircleUser, active: inMe, dot: unread },
  ]

  return (
    <nav
      aria-label={t('ui.shell.mainNav')}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden',
        className
      )}
    >
      <ul className="flex h-14">
        {tabs.map(({ href, label, Icon, active, dot }) => (
          <li key={label} className="min-w-0 flex-1">
            <Link
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-full flex-col items-center justify-center gap-1 text-[10px] leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                active ? 'font-semibold text-foreground' : 'text-muted-foreground'
              )}
            >
              <span className={cn('relative', active && 'text-primary')}>
                <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                {dot && (
                  <span
                    className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-card"
                    aria-label={t('ui.shell.unreadDot')}
                  />
                )}
              </span>
              <span>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
