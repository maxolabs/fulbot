'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { groupSlugFromPathname } from '@/lib/group-cookie'
import type { ShellCurrentGroup, ShellGroup, ShellUser } from './types'

// Client-side view of what AppShell knows: the user, their groups, the
// current group (from the fulbot_group cookie) and the unread notification
// count. The Sidebar refreshes the count on route change and writes it here
// so the TabBar's dot and the sidebar badge always agree.

export interface ShellState {
  user?: ShellUser
  groups: ShellGroup[]
  currentGroup?: ShellCurrentGroup
  unreadCount: number
  setUnreadCount: (n: number) => void
}

const ShellContext = React.createContext<ShellState | null>(null)

export function ShellProvider({
  user,
  groups,
  currentGroup,
  unreadCount: initialUnread,
  children,
}: {
  user?: ShellUser
  groups: ShellGroup[]
  currentGroup?: ShellCurrentGroup
  unreadCount: number
  children: React.ReactNode
}) {
  const [unreadCount, setUnreadCount] = React.useState(initialUnread)
  const pathname = usePathname()
  const routeSlug = groupSlugFromPathname(pathname)
  const [lastGroupSlug, setLastGroupSlug] = React.useState(currentGroup?.slug)
  // Layouts persist across client navigation. Resolve the visible route first,
  // then remember it for global pages such as Profile and Notifications.
  const selectedSlug = routeSlug ?? lastGroupSlug ?? currentGroup?.slug
  const selectedGroup = groups.find((group) => group.slug === selectedSlug)
  const resolvedGroup = React.useMemo<ShellCurrentGroup | undefined>(() => {
    if (!selectedGroup) return undefined
    if (selectedGroup.slug === currentGroup?.slug) return currentGroup
    return { ...selectedGroup, pendingRatings: 0 }
  }, [selectedGroup, currentGroup])

  React.useEffect(() => {
    if (routeSlug && groups.some((group) => group.slug === routeSlug)) {
      setLastGroupSlug(routeSlug)
    }
  }, [routeSlug, groups])

  // When the server refreshes the layout, accept its count as the baseline
  // until the sidebar's client refresh lands.
  React.useEffect(() => {
    setUnreadCount(initialUnread)
  }, [initialUnread])

  const value = React.useMemo<ShellState>(
    () => ({ user, groups, currentGroup: resolvedGroup, unreadCount, setUnreadCount }),
    [user, groups, resolvedGroup, unreadCount]
  )

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

/** The shell state, or null outside an AppShell (public pages). */
export function useShell(): ShellState | null {
  return React.useContext(ShellContext)
}
