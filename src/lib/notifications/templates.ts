// T5 notifications: Spanish (Rioplatense, "vos") text per notification type.
// Used both for the WhatsApp outbox body and the /notifications page list.

import type { NotificationEvent } from './types'

function formatDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(d)
  const time = new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(d)
  return { date, time }
}

export function renderNotificationText(event: NotificationEvent): string {
  switch (event.type) {
    case 'match_created': {
      const { date, time } = formatDateTime(event.payload.date_time)
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
        `Oscuro: ${event.payload.dark_team_names.join(', ')}. ` +
        `Claro: ${event.payload.light_team_names.join(', ')}.`
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
