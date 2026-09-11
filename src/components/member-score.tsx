import { Star } from 'lucide-react'
import { getTranslation, type Language } from '@/i18n/core'
import { cn } from '@/lib/utils/cn'
import type { MemberBreakdown } from '@/types/database'

// Member score ("Compromiso", docs/member-scoring.md §3): how good someone is as
// a member of one group, 1..5 derived from member_events. Independent from the
// player rating in player-skills.tsx. No 'use client' here: both server pages and
// client components render these, so the language comes in as a prop.
//
// Callers own the visibility rule (§5.4): visibility = 'group', or the viewer is
// admin/captain of the group, or the viewer is the player. Never render these for
// anyone else.

export function formatMemberScore(score: number | null | undefined): string | null {
  return score === null || score === undefined ? null : Number(score).toFixed(1)
}

interface StarsProps {
  score: number | null | undefined
  /** compact: one star + number for lists. full: five stars + big number for detail pages. */
  variant?: 'compact' | 'full'
  language?: Language
  className?: string
}

export function MemberScoreStars({ score, variant = 'compact', language = 'es', className }: StarsProps) {
  const t = getTranslation(language)
  const formatted = formatMemberScore(score)
  const value = formatted === null ? null : Number(score)

  if (variant === 'compact') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-sm font-medium', className)}>
        <Star
          className={cn('h-4 w-4', value === null ? 'text-muted-foreground' : 'text-primary fill-primary')}
          aria-hidden="true"
        />
        {formatted ?? <span className="text-muted-foreground font-normal">{t('memberScore.new')}</span>}
      </span>
    )
  }

  const pct = value === null ? 0 : Math.max(0, Math.min(100, ((value - 1) / 4) * 100))

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="relative inline-flex" aria-hidden="true">
        <div className="flex gap-0.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} className="h-6 w-6 text-muted-foreground/40" />
          ))}
        </div>
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
          <div className="flex gap-0.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Star key={i} className="h-6 w-6 text-primary fill-primary" />
            ))}
          </div>
        </div>
      </div>
      {formatted === null ? (
        <span className="text-xl font-semibold text-muted-foreground">{t('memberScore.new')}</span>
      ) : (
        <span className="text-2xl font-bold">
          {formatted}
          <span className="text-sm font-normal text-muted-foreground"> /5</span>
        </span>
      )}
    </div>
  )
}

const DIMENSIONS = ['asistencia', 'aviso', 'puntualidad', 'reglas', 'participacion'] as const
type Dimension = (typeof DIMENSIONS)[number]

function barColor(ratio: number): string {
  if (ratio >= 0.75) return 'bg-primary'
  if (ratio >= 0.5) return 'bg-yellow-500'
  return 'bg-destructive'
}

function detailFor(t: (key: string, params?: Record<string, string | number>) => string, dim: Dimension, b: MemberBreakdown): string {
  switch (dim) {
    case 'asistencia':
      return t('memberScore.detail.asistencia', { played: b.asistencia.played, noShows: b.asistencia.no_shows })
    case 'aviso':
      return t('memberScore.detail.aviso', { early: b.aviso.early, late: b.aviso.late })
    case 'puntualidad':
      return t('memberScore.detail.puntualidad', { late: b.puntualidad.late_arrivals })
    case 'reglas':
      return t('memberScore.detail.reglas', { jersey: b.reglas.wrong_jersey, unpaid: b.reglas.unpaid })
    case 'participacion':
      return t('memberScore.detail.participacion', {
        participated: b.participacion.participated,
        eligible: b.participacion.eligible,
      })
  }
}

interface BreakdownProps {
  breakdown: MemberBreakdown | null | undefined
  language?: Language
  className?: string
}

// Five dimension bars with their counts, participation split into reported /
// rated / MVP / newcomers, the admin adjustments line and the raw points.
export function MemberScoreBreakdown({ breakdown, language = 'es', className }: BreakdownProps) {
  const t = getTranslation(language)
  if (!breakdown) {
    return <p className={cn('text-sm text-muted-foreground', className)}>{t('memberScore.newHint')}</p>
  }
  const b = breakdown
  const adjStars = Number(b.adjustments ?? 0)
  const adjPoints = Number(b.adjustment_points ?? 0)
  const signed = (n: number, digits = 0) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}`

  return (
    <div className={cn('space-y-4', className)}>
      <p className="text-xs text-muted-foreground">
        {t('memberScore.windowSummary', { played: b.played, window: b.window_matches })}
        {b.is_new && <> · {t('memberScore.newHint')}</>}
      </p>

      <div className="space-y-3">
        {DIMENSIONS.map((dim) => {
          const ratio = Math.max(0, Math.min(1, Number(b[dim].ratio)))
          return (
            <div key={dim} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{t(`memberScore.dimensions.${dim}`)}</span>
                <span className="text-xs text-muted-foreground text-right">{detailFor(t, dim, b)}</span>
              </div>
              <div className="h-2 rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label={t(`memberScore.dimensions.${dim}`)}>
                <div className={cn('h-full rounded-full transition-all', barColor(ratio))} style={{ width: `${ratio * 100}%` }} />
              </div>
              {dim === 'participacion' && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground pt-0.5">
                  <span>{t('memberScore.detail.reported', { n: b.participacion.reported })}</span>
                  <span>{t('memberScore.detail.rated', { n: b.participacion.rated })}</span>
                  <span>{t('memberScore.detail.votedMvp', { n: b.participacion.voted_mvp })}</span>
                  <span>
                    {t('memberScore.detail.ratedNew', {
                      rated: b.participacion.newcomers_rated,
                      eligible: b.participacion.newcomers_eligible,
                    })}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground border-t pt-3">
        <span>
          {t('memberScore.adjustments')}:{' '}
          <span className={cn('font-medium', adjPoints > 0 ? 'text-primary' : adjPoints < 0 ? 'text-destructive' : 'text-foreground')}>
            {t('memberScore.adjustmentsValue', { stars: signed(adjStars, 2), points: signed(adjPoints) })}
          </span>
        </span>
        <span>
          {t('memberScore.rawPoints')}: <span className="font-medium text-foreground">{signed(Number(b.raw_points ?? 0))}</span>
        </span>
      </div>
    </div>
  )
}
