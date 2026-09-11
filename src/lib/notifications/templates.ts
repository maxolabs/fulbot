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

// The SQL job handlers store report_url without a host when
// app.settings.app_url is not configured on the database (§11.1). Prefix it
// with NEXT_PUBLIC_APP_URL here so both the WhatsApp text and the in-app list
// get an absolute link; already-absolute values pass through untouched.
export function resolveReportUrl(url: string | null | undefined): string {
  const raw = (url ?? '').trim()
  if (/^https?:\/\//i.test(raw)) return raw
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  if (!raw) return base
  return `${base}${raw.startsWith('/') ? '' : '/'}${raw}`
}

function pluralGoles(n: number): string {
  return n === 1 ? '1 gol' : `${n} goles`
}

function joinNames(names: string[]): string {
  return names.join(', ')
}

export interface RenderOptions {
  // 'whatsapp' (default) includes the report link in the text; 'inapp' leaves
  // it out because the notification card itself links to the match page.
  channel?: 'whatsapp' | 'inapp'
}

export function renderNotificationText(
  event: NotificationEvent,
  timeZone: string = DEFAULT_TIMEZONE,
  options: RenderOptions = {}
): string {
  const withLink = options.channel !== 'inapp'
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
    case 'results_posted': {
      const p = event.payload
      const parts: string[] = [`Resultado: Oscuro ${p.dark_score} – Claro ${p.light_score}.`]
      const scorers = (p.scorers ?? []).filter((s) => s.goals > 0)
      if (scorers.length > 0) {
        parts.push(
          `Goles: ${joinNames(scorers.map((s) => (s.goals > 1 ? `${s.name} (${s.goals})` : s.name)))}.`
        )
      }
      const assisters = (p.assisters ?? []).filter((a) => a.assists > 0)
      if (assisters.length > 0) {
        parts.push(
          `Asistencias: ${joinNames(assisters.map((a) => (a.assists > 1 ? `${a.name} (${a.assists})` : a.name)))}.`
        )
      }
      const unattributed = (p.unattributed?.dark ?? 0) + (p.unattributed?.light ?? 0)
      if (unattributed > 0) {
        parts.push(`${pluralGoles(unattributed)} sin autor.`)
      }
      if (p.mvp_name) {
        parts.push(`MVP: ${p.mvp_name}.`)
      }
      if (p.status === 'consensus') {
        parts.push('(Consenso del grupo)')
      }
      return parts.join(' ')
    }
    case 'results_request': {
      const { date } = formatDateTime(event.payload.date_time, timeZone)
      const link = withLink ? `: ${resolveReportUrl(event.payload.report_url)}` : '.'
      return (
        `¿Cómo salió el partido del ${date} (${event.payload.group_name})? ` +
        `Cargá el resultado, los goles y el MVP${link}`
      )
    }
    case 'results_reminder': {
      const { date } = formatDateTime(event.payload.date_time, timeZone)
      const names = event.payload.pending_player_names ?? []
      const who = names.length > 0 ? ` Faltan: ${joinNames(names)}.` : ''
      const link = withLink ? `: ${resolveReportUrl(event.payload.report_url)}` : '.'
      return (
        `Todavía falta cerrar el resultado del ${date} (${event.payload.group_name}).${who} ` +
        `Cargá lo que te acuerdes${link}`
      )
    }
    case 'results_needs_review': {
      const { date } = formatDateTime(event.payload.date_time, timeZone)
      return (
        `Cerró la ventana del partido del ${date} (${event.payload.group_name}) ` +
        `sin reportes. Cargá el resultado a mano cuando puedas.`
      )
    }
    case 'rate_new_member':
      return `¡${event.payload.player_name} se sumó al grupo! Si ya jugaste con esa persona, dejá tu calificación para que los equipos salgan parejos.`
    case 'results_changed': {
      const { date } = formatDateTime(event.payload.date_time, timeZone)
      const mvp = event.payload.mvp_name ? ` MVP: ${event.payload.mvp_name}.` : ''
      return (
        `El resultado del ${date} (${event.payload.group_name}) cambió de ${event.payload.previous} ` +
        `a ${event.payload.current} después de ser publicado.${mvp} Revisalo y cerralo si corresponde.`
      )
    }
    default: {
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}
