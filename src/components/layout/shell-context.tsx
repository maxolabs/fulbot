'use client'

import * as React from 'react'
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

  // The server re-renders the layout with a fresh count on navigation; take
  // it as the new baseline until the client refresh lands.
  React.useEffect(() => {
    setUnreadCount(initialUnread)
  }, [initialUnread])

  const value = React.useMemo<ShellState>(
    () => ({ user, groups, currentGroup, unreadCount, setUnreadCount }),
    [user, groups, currentGroup, unreadCount]
  )

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

/** The shell state, or null outside an AppShell (public pages). */
export function useShell(): ShellState | null {
  return React.useContext(ShellContext)
}
