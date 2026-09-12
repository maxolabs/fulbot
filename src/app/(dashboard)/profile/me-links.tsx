'use client'

import Link from 'next/link'
import { Bell, ChevronRight, Settings } from 'lucide-react'
import { useShell } from '@/components/layout/shell-context'
import { useT } from '@/i18n/provider'

// Mobile-only rows at the top of the `Yo` tab (docs/ui-rework/03-screens.md
// §10): Avisos with the unread count from the shell context, and
// Preferencias. In the browser the sidebar carries both, so this is lg:hidden.

const rowClassName =
  'flex min-h-11 items-center gap-3 border-b border-border py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background hover:bg-accent/60'

export function MeLinks() {
  const t = useT()
  const shell = useShell()
  const unread = shell?.unreadCount ?? 0

  return (
    <nav aria-label={t('ui.shell.globalNav')} className="lg:hidden">
      <ul className="[&>li:last-child>a]:border-b-0">
        <li>
          <Link href="/notifications" className={rowClassName}>
            <Bell className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
            <span className={unread > 0 ? 'flex-1 font-semibold' : 'flex-1'}>{t('ui.shell.notifications')}</span>
            {unread > 0 && (
              <span
                aria-label={t('ui.shell.unread', { n: unread })}
                className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-primary px-1.5 font-mono text-[10px] font-medium leading-none text-primary-foreground"
              >
                {unread > 9 ? '9+' : unread}
              </span>
            )}
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </li>
        <li>
          <Link href="/settings" className={rowClassName}>
            <Settings className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
            <span className="flex-1">{t('ui.shell.preferences')}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </li>
      </ul>
    </nav>
  )
}
