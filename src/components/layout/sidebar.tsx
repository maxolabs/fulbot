'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Bell, CalendarDays, Home, LogOut, Settings, Star, User, Users } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Popover } from '@/components/ui/popover'
import { disableDevicePush } from '@/lib/notifications/device-client'
import { createClient } from '@/lib/supabase/client'
import { groupSlugFromPathname } from '@/lib/group-cookie'
import { useT } from '@/i18n/provider'
import { cn } from '@/lib/utils/cn'
import { GroupSwitcher } from './group-switcher'
import { useShell } from './shell-context'
import { Wordmark } from './wordmark'
import type { ShellCurrentGroup, ShellGroup, ShellUser } from './types'

// Browser sidebar (docs/ui-rework/02-shell.md §1). Brand row, group switcher
// and group nav when the route is inside one of the user's groups, then the
// global items: Avisos with the unread badge and the user row with the menu.
// Active item is `bg-accent` (the only orange in the chrome is the mobile
// tab bar). Owns the unread-count refresh on route change.

export interface SidebarProps {
  user?: ShellUser
  groups: ShellGroup[]
  currentGroup?: ShellCurrentGroup
  unreadCount: number
  className?: string
}

const itemClassName =
  'flex h-10 items-center gap-3 rounded-[3px] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card'

const menuItemClassName =
  'flex min-h-10 w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'

function CountBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null
  return (
    <span
      aria-label={label}
      className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-primary px-1 font-mono text-[10px] font-medium leading-none text-primary-foreground"
    >
      {count > 9 ? '9+' : count}
    </span>
  )
}

export function Sidebar({ user, groups, currentGroup, unreadCount: initialUnread, className }: SidebarProps) {
  const t = useT()
  const pathname = usePathname()
  const router = useRouter()
  const shell = useShell()
  const [localUnread, setLocalUnread] = React.useState(initialUnread)
  const unreadCount = shell ? shell.unreadCount : localUnread
  const setUnread = shell ? shell.setUnreadCount : setLocalUnread

  // Refresh the unread count on mount and whenever the route changes (after
  // visiting /notifications and marking things read, for example).
  React.useEffect(() => {
    if (!user) return
    let cancelled = false
    const supabase = createClient()
    supabase.rpc('get_unread_notification_count').then(({ data, error }) => {
      if (cancelled || error) return
      if (typeof data === 'number') setUnread(data)
    })
    return () => {
      cancelled = true
    }
  }, [user, pathname, setUnread])

  const handleSignOut = async () => {
    const supabase = createClient()
    await disableDevicePush().catch(() => {})
    await supabase.auth.signOut()
    router.push('/login')
  }

  const slug = groupSlugFromPathname(pathname)
  const routeGroup = slug ? groups.find((g) => g.slug === slug) : undefined
  const groupBase = routeGroup ? `/groups/${routeGroup.slug}` : null
  const selectedGroup = shell?.currentGroup ?? currentGroup
  const groupData = routeGroup && selectedGroup?.slug === routeGroup.slug ? selectedGroup : undefined
  const isAdmin = routeGroup?.role === 'admin'
  const isAdminOrCaptain = isAdmin || routeGroup?.role === 'captain'
  const pendingRatings = groupData?.pendingRatings ?? 0

  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)

  const navItem = (
    href: string,
    label: string,
    Icon: typeof Home,
    active: boolean,
    trailing?: React.ReactNode
  ) => (
    <li key={href}>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          itemClassName,
          active
            ? 'bg-accent font-semibold text-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        )}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
        <span className="truncate">{label}</span>
        {trailing}
      </Link>
    </li>
  )

  return (
    <aside
      className={cn(
        'sticky top-0 z-30 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-card lg:flex',
        className
      )}
    >
      <div className="flex h-20 shrink-0 items-center px-6">
        <Link
          href="/groups"
          className="rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <Wordmark size="md" withMark />
        </Link>
      </div>

      {routeGroup && groupBase && (
        <>
          <div className="px-3 pb-3 [&>div]:w-full">
            <GroupSwitcher groups={groups} current={routeGroup} presentation="popover" />
          </div>
          <nav aria-label={t('ui.shell.groupNav')} className="px-3">
            <ul className="space-y-0.5">
              {navItem(groupBase, t('ui.shell.home'), Home, isActive(groupBase, true))}
              {navItem(`${groupBase}/matches`, t('ui.shell.matches'), CalendarDays, isActive(`${groupBase}/matches`))}
              {navItem(`${groupBase}/players`, t('ui.shell.players'), Users, isActive(`${groupBase}/players`))}
              {(pendingRatings > 0 || isAdminOrCaptain) &&
                navItem(
                  `${groupBase}/rate`,
                  t('ui.shell.rate'),
                  Star,
                  isActive(`${groupBase}/rate`),
                  <CountBadge count={pendingRatings} label={t('ui.shell.pendingRatings', { n: pendingRatings })} />
                )}
              {isAdmin && navItem(`${groupBase}/settings`, t('ui.shell.groupSettings'), Settings, isActive(`${groupBase}/settings`))}
            </ul>
          </nav>
        </>
      )}

      <div className="flex-1" aria-hidden="true" />

      <nav aria-label={t('ui.shell.globalNav')} className="px-3 pb-2">
        <ul className="space-y-0.5">
          {navItem('/groups', t('ui.shell.myGroups'), Users, isActive('/groups', true))}
          {navItem(
            '/notifications',
            t('ui.shell.notifications'),
            Bell,
            isActive('/notifications'),
            <CountBadge count={unreadCount} label={t('ui.shell.unread', { n: unreadCount })} />
          )}
        </ul>
      </nav>

      {user && (
        <div className="border-t border-border p-3 [&>div]:w-full">
          <Popover
            align="left"
            aria-label={t('ui.shell.userMenu')}
            triggerClassName="flex h-11 w-full items-center gap-3 rounded-[3px] px-2 text-left hover:bg-accent focus-visible:ring-offset-card"
            className="bottom-full mb-2 mt-0 w-56"
            trigger={
              <>
                <Avatar src={user.avatar_url} fallback={user.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{user.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                </span>
              </>
            }
          >
            {({ close }) => (
              <div className="py-1">
                <Link href="/profile" onClick={close} className={menuItemClassName}>
                  <User className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
                  {t('nav.profile')}
                </Link>
                <Link href="/settings" onClick={close} className={menuItemClassName}>
                  <Settings className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
                  {t('nav.settings')}
                </Link>
                <button type="button" onClick={handleSignOut} className={cn(menuItemClassName, 'text-destructive')}>
                  <LogOut className="h-4 w-4" strokeWidth={1.75} />
                  {t('nav.logout')}
                </button>
              </div>
            )}
          </Popover>
        </div>
      )}
    </aside>
  )
}
