import type { TranslateFn } from '@/i18n/core'
import { formatMatchTime, weekdayIndexInTimezone } from '@/lib/utils/datetime'

// Zone-aware date labels for the match screens (docs/ui-rework/03-screens.md
// §2, §3, §5): "Lunes 14 sep · 20:00" for heroes and "Lun 14 sep" for rows.
// Built from formatToParts with an explicit timeZone like the helpers in
// src/lib/utils/datetime.ts, so the server and the browser agree byte for
// byte; the words come from i18n so the language follows the user.

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

function dayMonthInTimezone(date: Date | string, timeZone: string): { day: number; month: number } {
  const d = typeof date === 'string' ? new Date(date) : date
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, day: 'numeric', month: 'numeric' }).formatToParts(d)
  const map: Record<string, string> = {}
  for (const part of parts) if (part.type !== 'literal') map[part.type] = part.value
  return { day: Number(map.day), month: Number(map.month) }
}

/** "Lunes 14 sep · 20:00" */
export function formatHeroDate(t: TranslateFn, date: Date | string, timeZone: string): string {
  const { day, month } = dayMonthInTimezone(date, timeZone)
  return t('ui.matchScreens.heroDate', {
    weekday: t(`days.${DAY_KEYS[weekdayIndexInTimezone(date, timeZone)]}`),
    day,
    month: t(`ui.matchScreens.monthsShort.${month}`),
    time: formatMatchTime(date, timeZone),
  })
}

/** "Lunes 14 sep" (full weekday) */
export function formatRowDate(t: TranslateFn, date: Date | string, timeZone: string): string {
  const { day, month } = dayMonthInTimezone(date, timeZone)
  return t('ui.matchScreens.dateShort', {
    weekday: t(`days.${DAY_KEYS[weekdayIndexInTimezone(date, timeZone)]}`),
    day,
    month: t(`ui.matchScreens.monthsShort.${month}`),
  })
}

/** "Lun 14 sep" (short weekday) */
export function formatShortDate(t: TranslateFn, date: Date | string, timeZone: string): string {
  const { day, month } = dayMonthInTimezone(date, timeZone)
  return t('ui.matchScreens.dateShort', {
    weekday: t(`ui.matchScreens.daysShort.${DAY_KEYS[weekdayIndexInTimezone(date, timeZone)]}`),
    day,
    month: t(`ui.matchScreens.monthsShort.${month}`),
  })
}
