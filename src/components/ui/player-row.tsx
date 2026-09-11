import * as React from 'react'
import Link from 'next/link'
import { Avatar } from '@/components/ui/avatar'
import { getTranslation, type Language } from '@/i18n/core'
import { cn } from '@/lib/utils/cn'

// The single roster row (docs/ui-rework/04-components.md §2) used by the
// dashboard, the match, the players list and /m. Renders an <a> when `href`
// is given, a <div> otherwise; callers wrap rows in <ul>/<ol> + <li>.
//
// Every row draws a solid border-b; the list drops the last one. With rows
// inside <li>: `<ul className="[&>li:last-child>*]:border-b-0">`. With rows as
// direct siblings: `<div className="[&>*:last-child]:border-b-0">`. (A `last:`
// on the row itself would match every row, since each is its <li>'s only child.)
//
// No 'use client': server pages render rosters. Client callers pass
// `language={useLanguage()}`; it defaults to 'es'.

export interface PlayerRowProps {
  index?: number
  name: string
  nickname?: string | null
  avatarUrl?: string | null
  position?: string | null
  guest?: boolean
  trailing?: React.ReactNode
  href?: string
  language?: Language
  className?: string
}

export function PlayerRow({
  index,
  name,
  nickname,
  avatarUrl,
  position,
  guest = false,
  trailing,
  href,
  language = 'es',
  className,
}: PlayerRowProps) {
  const t = getTranslation(language)

  const rowClassName = cn(
    'flex min-h-11 w-full items-center gap-3 border-b border-border py-2 text-left',
    href &&
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background hover:bg-accent/60',
    className
  )

  const content = (
    <>
      {index !== undefined && (
        <span className="w-5 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {index}
        </span>
      )}
      <Avatar src={avatarUrl} fallback={name} size="xs" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="truncate text-sm font-medium">{name}</span>
        {nickname && (
          <span className="truncate text-xs text-muted-foreground">({nickname})</span>
        )}
        {guest && (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t('ui.guest')}
          </span>
        )}
      </span>
      {trailing !== undefined ? (
        <span className="flex shrink-0 items-center gap-2">{trailing}</span>
      ) : position ? (
        <PositionChip position={position} />
      ) : null}
    </>
  )

  if (href) {
    return (
      <Link href={href} className={rowClassName}>
        {content}
      </Link>
    )
  }
  return <div className={rowClassName}>{content}</div>
}

// Mono position tag (GK, CM, …). Exported so trailing slots can reuse it.
export function PositionChip({
  position,
  className,
}: {
  position: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-sm border border-border px-1.5 py-px font-mono text-[9px] uppercase leading-tight tracking-[.08em] text-muted-foreground',
        className
      )}
    >
      {position}
    </span>
  )
}
