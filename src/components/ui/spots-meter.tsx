import { getTranslation, type Language } from '@/i18n/core'
import { cn } from '@/lib/utils/cn'

// Spots meter (docs/ui-rework/04-components.md §2): cone fill over a faded
// track, "11 de 14 anotados" on the left and "3 lugares · 2 en espera" on the
// right. Full state turns the bar success and says "Completo", so colour is
// never the only carrier of the state (06-principles.md §9).
//
// No 'use client': server pages (dashboard, match, /m) render it directly.
// Client callers pass `language={useLanguage()}`; it defaults to 'es'.

export interface SpotsMeterProps {
  confirmed: number
  max: number
  waitlist?: number
  size?: 'sm' | 'md'
  language?: Language
  className?: string
}

export function SpotsMeter({
  confirmed,
  max,
  waitlist = 0,
  size = 'md',
  language = 'es',
  className,
}: SpotsMeterProps) {
  const t = getTranslation(language)
  const safeMax = Math.max(0, max)
  const safeConfirmed = Math.max(0, confirmed)
  const full = safeMax > 0 && safeConfirmed >= safeMax
  const left = Math.max(0, safeMax - safeConfirmed)
  const pct = safeMax === 0 ? 0 : Math.min(100, (safeConfirmed / safeMax) * 100)

  const right: string[] = []
  if (full) right.push(t('ui.spots.full'))
  else right.push(left === 1 ? t('ui.spots.leftOne') : t('ui.spots.left', { n: left }))
  if (waitlist > 0) right.push(t('ui.spots.waiting', { n: waitlist }))

  return (
    <div className={cn('space-y-1.5', className)}>
      <div
        role="meter"
        aria-label={t('ui.spots.label')}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={Math.min(safeConfirmed, safeMax)}
        aria-valuetext={`${safeConfirmed} / ${safeMax}`}
        className={cn(
          'w-full overflow-hidden rounded-sm bg-muted',
          size === 'sm' ? 'h-1.5' : 'h-2.5'
        )}
      >
        <div
          className={cn('h-full rounded-sm', full ? 'bg-success' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div
        className={cn(
          'flex items-baseline justify-between gap-3 font-mono tabular-nums text-muted-foreground',
          size === 'sm' ? 'text-[11px]' : 'text-xs'
        )}
      >
        <span>
          <strong className="font-medium text-foreground">{safeConfirmed}</strong>{' '}
          {t('ui.spots.of', { max: safeMax })}
        </span>
        <span className={cn('text-right', full && 'font-medium text-foreground')}>
          {right.join(' · ')}
        </span>
      </div>
    </div>
  )
}
