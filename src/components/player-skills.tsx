import { Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  DIMENSION_LABELS,
  DIMENSION_SHORT,
  RATING_DIMENSIONS,
  overallOf,
  tagLabel,
  type RatingSummary,
} from '@/lib/ratings'

// Score displays. Only render these for admins and captains: player_rating_summary
// is not readable by anyone else, so a member would only ever see defaults here.

function fmt(value: number | null | undefined): string {
  return value === null || value === undefined ? '–' : value.toFixed(1)
}

// One line for lists: ★ 3.7 · ARQ 1.3 · DEF 4.0 · ATA 4.1 · FÍS 3.9
export function SkillSummaryLine({ summary }: { summary: RatingSummary | undefined | null }) {
  const noData = !summary || (summary.peer_votes === 0 && summary.matches_rated === 0)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="flex items-center gap-1 font-medium">
        <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
        {overallOf(summary).toFixed(1)}
      </span>
      {noData ? (
        <span className="text-xs text-muted-foreground">Sin calificaciones todavía</span>
      ) : (
        RATING_DIMENSIONS.map((dim) => (
          <span key={dim} className="text-xs text-muted-foreground" title={DIMENSION_LABELS[dim]}>
            {DIMENSION_SHORT[dim]} <span className="font-medium text-foreground">{fmt(summary?.[dim])}</span>
          </span>
        ))
      )}
    </div>
  )
}

// Block for the player detail page: big overall, four dimensions, tags, vote counts.
export function SkillSummaryCard({ summary }: { summary: RatingSummary | undefined | null }) {
  const noData = !summary || (summary.peer_votes === 0 && summary.matches_rated === 0)
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <Star className="h-6 w-6 text-yellow-500 fill-yellow-500" />
          <span className="text-2xl font-bold">{overallOf(summary).toFixed(1)}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {noData ? (
            'Sin calificaciones todavía'
          ) : (
            <>
              {summary!.peer_votes} {summary!.peer_votes === 1 ? 'voto' : 'votos'} de compañeros
              {summary!.matches_rated > 0 && (
                <> · {summary!.matches_rated} {summary!.matches_rated === 1 ? 'partido' : 'partidos'} calificados</>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {RATING_DIMENSIONS.map((dim) => {
          const value = summary?.[dim] ?? null
          const pct = value === null ? 0 : ((value - 1) / 4) * 100
          return (
            <div key={dim} className="space-y-1">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">{DIMENSION_LABELS[dim]}</span>
                <span className="text-sm font-semibold">{fmt(value)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
      </div>

      {summary && summary.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {summary.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tagLabel(tag)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
