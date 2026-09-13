import * as React from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { badgeVariants, type BadgeProps } from '@/components/ui/badge'
import { cn } from '@/lib/utils/cn'

// Match rows (docs/ui-rework/03-screens.md §2, §5; 06-principles.md §3):
// full-width, solid border-b, the whole row is the link. Date in the display
// face at 16px, time and location in mono, a status badge or the score on
// the right. Server-safe: no hooks.
//
// Lists drop the last border with `<ul className="[&>li:last-child>a]:border-b-0">`.

export const STATUS_BADGE_VARIANT: Record<string, NonNullable<BadgeProps['variant']>> = {
  draft: 'outline',
  signup_open: 'success',
  signup_closed: 'secondary',
  full: 'success', // a full match is a good state, like the SpotsMeter's (01-brand §1)
  teams_created: 'secondary',
  finished: 'outline',
  cancelled: 'destructive',
}

/** Status badge as a <span>, so it can sit inside <p> (page header subtitle) without a hydration error. */
export function MatchStatusBadge({ status, label, className }: { status: string; label: string; className?: string }) {
  return (
    <span className={cn(badgeVariants({ variant: STATUS_BADGE_VARIANT[status] ?? 'outline' }), className)}>
      {label}
    </span>
  )
}

/** "4 – 3" in the display face; `null` scores render an em dash. */
export function ScoreText({
  dark,
  light,
  className,
}: {
  dark: number | null
  light: number | null
  className?: string
}) {
  return (
    <span className={cn('font-display font-bold tabular-nums', className)}>
      {dark ?? '–'}
      <span className="mx-1 text-muted-foreground">–</span>
      {light ?? '–'}
    </span>
  )
}

export interface MatchRowProps {
  href: string
  /** "Lunes 14 sep" */
  date: string
  /** "20:00 · Cancha Los Pinos" (mono) */
  meta?: string
  /** Status badge, score, count… */
  trailing?: React.ReactNode
  className?: string
}

export function MatchRow({ href, date, meta, trailing, className }: MatchRowProps) {
  return (
    <Link
      href={href}
      className={cn(
        'flex min-h-14 w-full items-center gap-3 border-b border-border py-3 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className
      )}
    >
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block truncate font-display text-base font-bold leading-tight">{date}</span>
        {meta && (
          <span className="block truncate font-mono text-xs tabular-nums text-muted-foreground">{meta}</span>
        )}
      </span>
      {trailing !== undefined && <span className="flex shrink-0 items-center gap-2">{trailing}</span>}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
    </Link>
  )
}
