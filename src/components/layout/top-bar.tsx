'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { useT } from '@/i18n/provider'
import { cn } from '@/lib/utils/cn'
import { Wordmark } from './wordmark'
import { useTopBarState, type TopBarConfigValue } from './top-bar-slot'

export { TopBarProvider, TopBarConfig, useTopBar, useTopBarState } from './top-bar-slot'
export type { TopBarConfigValue } from './top-bar-slot'

// Mobile top bar (docs/ui-rework/02-shell.md §2): 48px, sticky, blurred
// background. Left: back chevron when the page set one. Centre-left: the
// page title in the display face, or the wordmark when there is none. Right:
// one optional context action. Everything comes from the TopBarSlot context;
// props are the fallback for a page that renders its own TopBar.

const iconButtonClassName =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[3px] text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

/** A 44px touch target for the top bar's right slot (link or button). */
export function TopBarAction({
  href,
  onClick,
  label,
  children,
  className,
}: {
  href?: string
  onClick?: () => void
  label: string
  children: React.ReactNode
  className?: string
}) {
  if (href) {
    return (
      <Link href={href} aria-label={label} className={cn(iconButtonClassName, className)}>
        {children}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} className={cn(iconButtonClassName, className)}>
      {children}
    </button>
  )
}

export interface TopBarProps extends TopBarConfigValue {
  className?: string
}

export function TopBar(props: TopBarProps) {
  const t = useT()
  const router = useRouter()
  const slot = useTopBarState()

  const title = slot.title ?? props.title
  const back = slot.back ?? props.back
  const action = slot.action ?? props.action
  const brand = slot.brand ?? props.brand ?? title === undefined

  return (
    <header
      className={cn(
        'sticky top-0 z-40 h-12 border-b border-border bg-background/90 backdrop-blur lg:hidden',
        props.className
      )}
    >
      <div className="flex h-full items-center gap-1 px-2">
        {back === true ? (
          <button
            type="button"
            onClick={() => router.back()}
            aria-label={t('ui.shell.back')}
            className={iconButtonClassName}
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
          </button>
        ) : back ? (
          <Link href={back} aria-label={t('ui.shell.back')} className={iconButtonClassName}>
            <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
          </Link>
        ) : null}

        <div className={cn('flex min-w-0 flex-1 items-center', !back && 'pl-2')}>
          {brand ? (
            <Link
              href="/groups"
              className="rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Wordmark size="md" />
            </Link>
          ) : typeof title === 'string' ? (
            <h1 className="truncate font-display text-[17px] font-bold leading-none tracking-tight">
              {title}
            </h1>
          ) : (
            title
          )}
        </div>

        {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
      </div>
    </header>
  )
}
