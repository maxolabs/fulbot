import { Eyebrow } from '@/components/ui/eyebrow'

// The result block of a match that finished without teams (00034, OD-3):
// there is no score, report or MVP, only the attendance of the confirmed
// list below it. Shown to everyone in place of the report form and the
// consensus card; the "Solo asistencia" badge sits in the hero. Server-safe:
// no hooks.
export function AttendanceOnlyResult({
  eyebrow,
  body,
  hint,
}: {
  eyebrow: string
  body: string
  /** Organizers: how to correct the attendance. */
  hint?: string
}) {
  return (
    <section
      aria-labelledby="attendance-only-title"
      className="space-y-2 lg:rounded-md lg:border lg:border-dashed lg:border-border lg:bg-card lg:p-5"
    >
      <Eyebrow as="h2" id="attendance-only-title">
        {eyebrow}
      </Eyebrow>
      <p className="text-sm text-pretty">{body}</p>
      {hint && <p className="text-sm text-muted-foreground text-pretty">{hint}</p>}
    </section>
  )
}
