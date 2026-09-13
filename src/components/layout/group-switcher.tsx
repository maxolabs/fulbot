'use client'

import * as React from 'react'
import Link from 'next/link'
import { Check, ChevronDown, ChevronsUpDown, KeyRound, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Popover } from '@/components/ui/popover'
import { Sheet } from '@/components/ui/sheet'
import { useT } from '@/i18n/provider'
import { cn } from '@/lib/utils/cn'
import { useShell } from './shell-context'
import type { ShellGroup } from './types'

// Group switcher (docs/ui-rework/02-shell.md §1.2 and §2): the same list of
// the user's groups in two presentations. `popover` is the sidebar button
// (name + chevron, anchored panel); `sheet` is the mobile top-bar title
// (name + chevron, bottom sheet). Both end with "Crear grupo" and "Unirme
// con código".

export interface GroupSwitcherProps {
  groups: ShellGroup[]
  current?: ShellGroup
  presentation: 'popover' | 'sheet'
  className?: string
}

const rowClassName =
  'flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'

function roleVariant(role: ShellGroup['role']): 'secondary' | 'outline' {
  return role === 'member' ? 'outline' : 'secondary'
}

function GroupList({
  groups,
  current,
  onNavigate,
}: {
  groups: ShellGroup[]
  current?: ShellGroup
  onNavigate: () => void
}) {
  const t = useT()
  return (
    <div className="py-1">
      <ul className="border-b border-border">
        {groups.map((g) => {
          const isCurrent = g.slug === current?.slug
          return (
            <li key={g.slug}>
              <Link
                href={`/groups/${g.slug}`}
                onClick={onNavigate}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(rowClassName, isCurrent && 'font-semibold')}
              >
                <span className="min-w-0 flex-1 truncate">{g.name}</span>
                <Badge variant={roleVariant(g.role)}>{t(`groups.roles.${g.role}`)}</Badge>
                <span className="flex w-4 shrink-0 justify-end" aria-hidden="true">
                  {isCurrent && <Check className="h-4 w-4 text-foreground" strokeWidth={2} />}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      <ul>
        <li>
          <Link href="/groups/new" onClick={onNavigate} className={rowClassName}>
            <Plus className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
            {t('ui.shell.createGroup')}
          </Link>
        </li>
        <li>
          <Link href="/invite" onClick={onNavigate} className={rowClassName}>
            <KeyRound className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
            {t('ui.shell.joinWithCode')}
          </Link>
        </li>
      </ul>
    </div>
  )
}

export function GroupSwitcher({ groups, current, presentation, className }: GroupSwitcherProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const label = current?.name ?? t('ui.shell.myGroups')

  if (presentation === 'popover') {
    return (
      <Popover
        align="left"
        aria-label={t('ui.shell.switchGroup')}
        triggerClassName={cn(
          'flex h-10 w-full items-center gap-2 rounded-[3px] border border-border px-3 text-left text-sm font-semibold text-foreground hover:bg-accent',
          className
        )}
        className="w-64"
        trigger={
          <>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          </>
        }
      >
        {({ close }) => <GroupList groups={groups} current={current} onNavigate={close} />}
      </Popover>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('ui.shell.switchGroup')}
        className={cn(
          '-ml-2 flex h-10 min-w-0 max-w-full items-center gap-1 rounded-[3px] px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          className
        )}
      >
        <span className="truncate font-display text-[17px] font-bold leading-none tracking-tight">
          {label}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={t('ui.shell.myGroups')} className="px-0 lg:px-0">
        <GroupList groups={groups} current={current} onNavigate={() => setOpen(false)} />
      </Sheet>
    </>
  )
}

/**
 * Pass this as the top bar `title` on the group dashboard:
 * `<TopBarConfig title={<GroupSwitcherTitle />} />`. It reads the user's
 * groups and the current group from the shell, so the page passes nothing.
 * Falls back to the group name as plain text outside an AppShell.
 */
export function GroupSwitcherTitle({ fallback }: { fallback?: string }) {
  const shell = useShell()
  if (!shell) {
    return (
      <h1 className="truncate font-display text-[17px] font-bold leading-none tracking-tight">{fallback}</h1>
    )
  }
  return <GroupSwitcher groups={shell.groups} current={shell.currentGroup} presentation="sheet" />
}
