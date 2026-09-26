import Link from 'next/link'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Organizer notice for a teams_created match whose confirmed list changed
// after the teams were published (matches.lineup_needs_review, 00029). The
// leaver's slot is already gone; someone has to place the newcomer and
// republish. Used on the match page (with the link) and on the teams page.
export function LineupStaleNotice({
  title,
  body,
  actionLabel,
  href,
}: {
  title: string
  body: string
  actionLabel?: string
  href?: string
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold">{title}</p>
          <p className="mt-0.5 text-pretty text-muted-foreground">{body}</p>
        </div>
      </div>
      {href && actionLabel && (
        <Button asChild variant="outline" size="sm">
          <Link href={href}>
            {actionLabel}
            <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </Button>
      )}
    </div>
  )
}
