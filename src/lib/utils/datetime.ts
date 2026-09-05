/**
 * Timezone-aware date/time helpers built on the Intl API only (no new
 * dependencies). Used to combine a "YYYY-MM-DD" date and "HH:mm" time picked
 * in a group's timezone into the correct UTC instant, and back.
 */

/**
 * Returns the offset (in minutes) such that:
 *   wallClockTimeInZone = instant + offset
 * i.e. how far "ahead" the zone's local clock reads compared to UTC at that
 * instant.
 */
function getTimezoneOffsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const parts = dtf.formatToParts(instant)
  const map: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value
  }

  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour === '24' ? '0' : map.hour),
    Number(map.minute),
    Number(map.second)
  )

  return (asUTC - instant.getTime()) / 60000
}

/**
 * Combines a date ("YYYY-MM-DD") and time ("HH:mm") that represent a wall
 * clock reading in `timeZone`, and returns the corresponding UTC Date.
 */
export function combineDateTimeInTimezone(
  date: string,
  time: string,
  timeZone: string
): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const wallClockUTC = Date.UTC(year, month - 1, day, hour, minute, 0)

  // Iterate to converge on the correct instant even across DST transitions.
  let instant = wallClockUTC
  for (let i = 0; i < 3; i++) {
    const offset = getTimezoneOffsetMinutes(new Date(instant), timeZone)
    const nextInstant = wallClockUTC - offset * 60000
    if (nextInstant === instant) break
    instant = nextInstant
  }

  return new Date(instant)
}

/**
 * Splits a UTC ISO datetime string into the "YYYY-MM-DD" date and "HH:mm"
 * time it corresponds to in `timeZone` — the inverse of
 * combineDateTimeInTimezone, used to prefill edit forms.
 */
export function splitDateTimeInTimezone(
  isoDateTime: string,
  timeZone: string
): { date: string; time: string } {
  const instant = new Date(isoDateTime)

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  const parts = dtf.formatToParts(instant)
  const map: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value
  }

  const hour = map.hour === '24' ? '00' : map.hour
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${hour}:${map.minute}`,
  }
}

/**
 * Deterministic, zone-aware display formatters for match/notification dates.
 *
 * These exist because `toLocaleDateString`/`toLocaleTimeString` (or any
 * `Intl.DateTimeFormat` call without an explicit `timeZone`) implicitly use
 * the *runtime's* local timezone -- which is UTC on Vercel and whatever the
 * visitor's machine is set to in the browser. That mismatch is what causes
 * matches to render at the wrong wall-clock hour on the server, and reading
 * the default `hour12`/`dayPeriod` behavior (" p. m." vs "PM") also differs
 * between Node's ICU and browser ICU, producing hydration mismatches.
 *
 * Every helper below takes the IANA `timeZone` explicitly, formats in 24h
 * time (never relying on locale-default hour12), and assembles the final
 * string itself from `formatToParts` rather than trusting `.format()`'s
 * locale-dependent punctuation/ordering -- so the output is byte-identical
 * on the server and in every browser.
 */

export const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires'

function toDate(date: Date | string): Date {
  return typeof date === 'string' ? new Date(date) : date
}

function capitalize(word: string): string {
  return word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
}

function getPartsMap(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions
): Record<string, string> {
  const dtf = new Intl.DateTimeFormat('es-AR', { timeZone, ...options })
  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value
  }
  return map
}

/** "Lunes" -- the capitalized Spanish weekday name in `timeZone`. */
export function formatWeekday(date: Date | string, timeZone: string): string {
  const map = getPartsMap(toDate(date), timeZone, { weekday: 'long' })
  return capitalize(map.weekday)
}

/** "Lunes 7/9/2026" -- capitalized weekday + d/M/yyyy, in `timeZone`. */
export function formatMatchDate(date: Date | string, timeZone: string): string {
  const d = toDate(date)
  const map = getPartsMap(d, timeZone, {
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  })
  return `${capitalize(map.weekday)} ${map.day}/${map.month}/${map.year}`
}

/** "Lunes 7/9" -- capitalized weekday + d/M (no year), in `timeZone`. */
export function formatMatchDateShort(date: Date | string, timeZone: string): string {
  const d = toDate(date)
  const map = getPartsMap(d, timeZone, {
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
  })
  return `${capitalize(map.weekday)} ${map.day}/${map.month}`
}

/**
 * "7/9/2026" -- d/M/yyyy with no weekday, in `timeZone`. For call sites that
 * already render a translated weekday label separately (e.g. via
 * `days.<key>` i18n strings) and just need the numeric date alongside it.
 */
export function formatMatchDateNumeric(date: Date | string, timeZone: string): string {
  const d = toDate(date)
  const map = getPartsMap(d, timeZone, { day: 'numeric', month: 'numeric', year: 'numeric' })
  return `${map.day}/${map.month}/${map.year}`
}

/** "07/09" -- zero-padded dd/MM with no weekday or year, in `timeZone`. */
export function formatMatchDayMonth(date: Date | string, timeZone: string): string {
  const d = toDate(date)
  const map = getPartsMap(d, timeZone, { day: '2-digit', month: '2-digit' })
  return `${map.day}/${map.month}`
}

/** "21:00" -- 24h, zero-padded, no "a. m./p. m.", in `timeZone`. */
export function formatMatchTime(date: Date | string, timeZone: string): string {
  const d = toDate(date)
  const map = getPartsMap(d, timeZone, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const hour = map.hour === '24' ? '00' : map.hour
  return `${hour}:${map.minute}`
}

/** "Lunes 7/9/2026 21:00" -- formatMatchDate + formatMatchTime, in `timeZone`. */
export function formatMatchDateTime(date: Date | string, timeZone: string): string {
  return `${formatMatchDate(date, timeZone)} ${formatMatchTime(date, timeZone)}`
}

const EN_WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/**
 * 0 (Sunday) - 6 (Saturday), matching `Date#getDay()`'s convention, but
 * computed from the wall-clock weekday in `timeZone` instead of the
 * runtime's local timezone. Use this (with a `days.<key>`-style translation
 * table) anywhere `date.getDay()` previously indexed into a weekday array or
 * translation key.
 */
export function weekdayIndexInTimezone(date: Date | string, timeZone: string): number {
  const d = toDate(date)
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(d).toLowerCase()
  const idx = EN_WEEKDAYS.indexOf(name)
  return idx === -1 ? d.getUTCDay() : idx
}
