import * as React from 'react'
import { ShellProvider } from './shell-context'
import { Sidebar } from './sidebar'
import { TabBar } from './tab-bar'
import { TopBar, TopBarProvider } from './top-bar'
import type { ShellCurrentGroup, ShellGroup, ShellUser } from './types'

// AppShell (docs/ui-rework/02-shell.md, 04-components.md §3). Server
// component mounted from (dashboard)/layout.tsx, which fetches the user's
// groups, the current group (from the fulbot_group cookie) and the unread
// count in one place. Both shells are rendered; the viewport picks one with
// CSS (`hidden lg:flex` / `lg:hidden`), so there is no flash and no
// hydration mismatch.
//
// Main: `px-4 pt-4 pb-20` on mobile (tab bar clearance; pages with an
// ActionBar add `pb-32` themselves), `max-w-6xl px-8 py-8` in the browser.

export interface AppShellProps {
  user?: ShellUser
  groups: ShellGroup[]
  currentGroup?: ShellCurrentGroup
  unreadCount: number
  children: React.ReactNode
}

export function AppShell({ user, groups, currentGroup, unreadCount, children }: AppShellProps) {
  return (
    <ShellProvider user={user} groups={groups} currentGroup={currentGroup} unreadCount={unreadCount}>
      <TopBarProvider>
        <div className="min-h-dvh bg-background lg:flex">
          <Sidebar user={user} groups={groups} currentGroup={currentGroup} unreadCount={unreadCount} />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <main className="w-full min-w-0 flex-1 px-4 pb-20 pt-4 lg:max-w-6xl lg:px-8 lg:py-8">
              {children}
            </main>
          </div>
          <TabBar currentGroup={currentGroup} unread={unreadCount > 0} />
        </div>
      </TopBarProvider>
    </ShellProvider>
  )
}
