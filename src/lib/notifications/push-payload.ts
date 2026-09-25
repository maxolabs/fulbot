import type { Language } from '@/i18n/core'
import type { NotificationType } from './types'

export interface PushEvent {
  notification_id: string
  type: NotificationType
  payload: Record<string, unknown>
  match_id: string | null
  group_slug: string
  group_name: string
  timezone: string | null
  language: Language
}

const labels = {
  es: {
    match_created: 'Se abrió la lista', waitlist_promoted: '¡Entraste al partido!',
    teams_created: 'Los equipos están listos', match_reminder: 'Se viene el partido',
    results_posted: 'Ya está el resultado', results_request: '¿Cómo salió el partido?',
    results_reminder: 'Falta tu resultado',
    open: 'Tocá para ver el partido.', signup: 'Tocá para anotarte.',
    report: 'Sumá el resultado y votá al MVP.',
  },
  en: {
    match_created: 'Signups are open', waitlist_promoted: 'You’re in!',
    teams_created: 'Teams are ready', match_reminder: 'Your match is coming up',
    results_posted: 'The result is in', results_request: 'How did the match go?',
    results_reminder: 'Your result is still missing',
    open: 'Tap to view the match.', signup: 'Tap to sign up.',
    report: 'Report the score and vote for MVP.',
  },
}

export function buildPushPayload(event: PushEvent) {
  const copy = labels[event.language] ?? labels.es
  const title = event.type in copy ? copy[event.type as keyof typeof copy] : 'fulbot'
  const reporting = event.type === 'results_request' || event.type === 'results_reminder'
  let date = ''
  if (typeof event.payload.date_time === 'string' && Number.isFinite(Date.parse(event.payload.date_time))) {
    try {
      date = new Intl.DateTimeFormat(event.language === 'en' ? 'en' : 'es-AR', {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        timeZone: event.timezone || 'America/Argentina/Buenos_Aires',
      }).format(new Date(event.payload.date_time))
    } catch { /* A malformed timezone must not block delivery. */ }
  }
  const groupPath = `/groups/${encodeURIComponent(event.group_slug)}`
  const matchPath = event.match_id ? `${groupPath}/matches/${encodeURIComponent(event.match_id)}` : groupPath
  return {
    title,
    body: [event.group_name, date, reporting ? copy.report : event.type === 'match_created' ? copy.signup : copy.open]
      .filter(Boolean).join(' · ').slice(0, 240),
    // Republished teams/results replace the previous alert for that match.
    tag: event.match_id && ['teams_created', 'results_posted', 'results_reminder'].includes(event.type)
      ? `fulbot-${event.type}-${event.match_id}` : `fulbot-${event.notification_id}`,
    url: `${matchPath}${reporting ? '#reportar' : event.type === 'teams_created' ? '/teams' : ''}`,
  }
}

// Push subscriptions are client input. Never turn them into an arbitrary
// server-side HTTP target; only send to browser vendors' push services.
export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false
    return url.hostname === 'fcm.googleapis.com'
      || url.hostname === 'updates.push.services.mozilla.com'
      || url.hostname.endsWith('.push.services.mozilla.com')
      || url.hostname === 'web.push.apple.com'
      || url.hostname.endsWith('.web.push.apple.com')
      || url.hostname.endsWith('.notify.windows.com')
  } catch { return false }
}
