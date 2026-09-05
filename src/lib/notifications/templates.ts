// T5 notifications: Spanish (Rioplatense, "vos") text per notification type.
// Used both for the WhatsApp outbox body and the /notifications page list.

import type { NotificationEvent } from './types'
import { DEFAULT_TIMEZONE, formatMatchDateShort, formatMatchTime } from '@/lib/utils/datetime'

// Both formatters take an explicit timeZone and assemble the string
// themselves (see src/lib/utils/datetime.ts), so this never depends on the
// process's local timezone nor on locale-default AM/PM (which used to
// differ between Node's ICU and the value stored on the outbox row).
function formatDateTime(iso: string, timeZone: string): { date: string; time: string } {
  return { date: formatMatchDateShort(iso, timeZone), time: formatMatchTime(iso, timeZone) }
}

export function renderNotificationText(
  event: NotificationEvent,
  timeZone: string = DEFAULT_TIMEZONE
): string {
  switch (event.type) {
    case 'match_created': {
      const { date, time } = formatDateTime(event.payload.date_time, timeZone)
      const location = event.payload.location ? ` en ${event.payload.location}` : ''
      return (
        `¡Partido confirmado! ${date} ${time}hs${location} -- ${event.payload.group_name}. ` +
        `Quedan ${event.payload.max_players} lugares. Anotate acá: ${event.payload.signup_url}`
      )
    }
    case 'waitlist_promoted':
      return `¡${event.payload.player_name} entró! Se liberó un lugar en la lista de espera y ahora está confirmado/a.`
    case 'teams_created':
      return (
        `¡Se armaron los equipos! ` +
        `Oscuro: ${(event.payload.dark_team_names ?? []).join(', ') || '—'}. ` +
        `Claro: ${(event.payload.light_team_names ?? []).join(', ') || '—'}.`
      )
    case 'match_reminder':
      return `Hoy ${event.payload.time} -- ${event.payload.group_name} -- remera oscura/clara según tu equipo`
    case 'results_posted':
      return `Resultado cargado: Oscuro ${event.payload.dark_score} - Claro ${event.payload.light_score}.`
    default: {
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}
