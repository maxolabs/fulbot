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
