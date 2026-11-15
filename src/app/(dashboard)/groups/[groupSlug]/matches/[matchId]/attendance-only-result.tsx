import { Badge } from '@/components/ui/badge'
import { Eyebrow } from '@/components/ui/eyebrow'

// The result block of a match that finished without teams (00034, OD-3):
// there is no score, report or MVP, only the attendance of the confirmed
// list below it. Shown to everyone in place of the report form and the
// consensus card. Server-safe: no hooks.
export function AttendanceOnlyResult({
  eyebrow,
  badge,
  body,
  hint,
}: {
  eyebrow: string
  badge: string
  body: string
  /** Organizers: how to correct the attendance. */
  hint?: string
}) {
  return (
    <section
      aria-labelledby="attendance-only-title"
      className="space-y-2 lg:rounded-md lg:border lg:border-dashed lg:border-border lg:bg-card lg:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <Eyebrow as="h2" id="attendance-only-title">
          {eyebrow}
        </Eyebrow>
        <Badge variant="outline">{badge}</Badge>
      </div>
      <p className="text-sm text-pretty">{body}</p>
      {hint && <p className="text-sm text-muted-foreground text-pretty">{hint}</p>}
    </section>
  )
}
