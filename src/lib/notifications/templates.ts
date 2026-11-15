// T5 notifications: text per notification type, used both for the WhatsApp
// outbox body and the /notifications page list. Strings live in the i18n
// files under ui.notifications.* (Spanish uses vos). The outbox renders in
// Spanish (groups have no language of their own yet); the in-app list
// renders in the viewer's language.

import type { LineupChangedPlayer, MemberScoreBreakdown, NotificationEvent } from './types'
import { getTranslation, type Language, type TranslateFn } from '@/i18n/core'
import {
  DEFAULT_TIMEZONE,
  calendarDaysFromNow,
  formatMatchDateShort,
  formatMatchTime,
} from '@/lib/utils/datetime'

// Both formatters take an explicit timeZone and assemble the string
// themselves (see src/lib/utils/datetime.ts), so this never depends on the
// process's local timezone nor on locale-default AM/PM (which used to
// differ between Node's ICU and the value stored on the outbox row).
function formatDateTime(iso: string, timeZone: string, language: Language): { date: string; time: string } {
  return { date: formatMatchDateShort(iso, timeZone, language), time: formatMatchTime(iso, timeZone) }
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

function joinNames(names: string[]): string {
  return names.join(', ')
}

// "a, b y c" / "a, b and c"
function joinList(items: string[], t: TranslateFn): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} ${t('ui.notifications.and')} ${items[items.length - 1]}`
}

function plural(t: TranslateFn, key: string, n: number): string {
  return t(`${key}${n === 1 ? 'One' : 'Many'}`, { count: n })
}

// One decimal, like MemberScoreStars on the player page.
function formatScore(score: number | null | undefined): string {
  return typeof score === 'number' && Number.isFinite(score) ? score.toFixed(1) : '—'
}

function atLocation(location: string | null | undefined, t: TranslateFn): string {
  return location ? t('ui.notifications.atLocation', { location }) : ''
}

function teamName(team: 'dark' | 'light' | null | undefined, t: TranslateFn): string {
  return team === 'light' ? t('ui.notifications.light') : t('ui.notifications.dark')
}

// Position codes come from team_assignments ('GK', 'CB', ...); unknown codes pass through.
function positionName(code: string | null | undefined, t: TranslateFn): string {
  if (!code) return ''
  const label = t(`positions.${code}`)
  return label === `positions.${code}` ? code : label
}

function playerNames(players: LineupChangedPlayer[] | undefined): string[] {
  return (players ?? []).map((p) => p.name).filter(Boolean)
}

// Human summary of what is dragging the score down, from the breakdown snapshot
// (docs/member-scoring.md §5.5: "Contás 2 bajas tarde en los últimos 10 partidos").
function describeScoreIssues(b: MemberScoreBreakdown | null | undefined, t: TranslateFn): string[] {
  if (!b) return []
  const k = 'ui.notifications.issues.'
  const issues: string[] = []
  const noShows = b.asistencia?.no_shows ?? 0
  if (noShows > 0) issues.push(plural(t, `${k}noShow`, noShows))
  const lateCancels = b.aviso?.late ?? 0
  if (lateCancels > 0) issues.push(plural(t, `${k}lateCancel`, lateCancels))
  const lateArrivals = b.puntualidad?.late_arrivals ?? 0
  if (lateArrivals > 0) issues.push(plural(t, `${k}lateArrival`, lateArrivals))
  const wrongJersey = b.reglas?.wrong_jersey ?? 0
  if (wrongJersey > 0) issues.push(plural(t, `${k}wrongJersey`, wrongJersey))
  const unpaid = b.reglas?.unpaid ?? 0
  if (unpaid > 0) issues.push(plural(t, `${k}unpaid`, unpaid))
  const missedParticipation = (b.participacion?.eligible ?? 0) - (b.participacion?.participated ?? 0)
  if (missedParticipation > 0) issues.push(plural(t, `${k}participation`, missedParticipation))
  const adjustment = b.adjustment_points ?? 0
  if (adjustment < 0) issues.push(t(`${k}adjustment`, { points: adjustment }))
  return issues
}

export interface RenderOptions {
  // 'whatsapp' (default) includes the report link in the text and speaks to
  // the whole group; 'inapp' leaves the link out (the row itself links to the
  // match page) and speaks to the viewer (waitlist_promoted is only shown to
  // the promoted player).
  channel?: 'whatsapp' | 'inapp'
  // Defaults to 'es': the outbox is sent in Spanish.
  language?: Language
  // For "Hoy" / "Mañana" in reminders; defaults to the current time.
  now?: Date
}

export function renderNotificationText(
  event: NotificationEvent,
  timeZone: string = DEFAULT_TIMEZONE,
  options: RenderOptions = {}
): string {
  const inApp = options.channel === 'inapp'
  const withLink = !inApp
  const language: Language = options.language === 'en' ? 'en' : 'es'
  const t = getTranslation(language)
  const k = 'ui.notifications.'
  const lk = 'ui.lifecycle.notifications.'

  switch (event.type) {
    case 'match_created': {
      const { date, time } = formatDateTime(event.payload.date_time, timeZone, language)
      const spots = event.payload.spots_left ?? event.payload.max_players
      return t(`${k}matchCreated`, {
        date,
        time,
        location: atLocation(event.payload.location, t),
        group: event.payload.group_name,
        spots: plural(t, `${k}spots`, spots),
        url: resolveReportUrl(event.payload.signup_url),
      })
    }
    case 'waitlist_promoted': {
      const p = event.payload
      const text = inApp ? t(`${k}waitlistPromotedYou`) : t(`${k}waitlistPromoted`, { name: p.player_name })
      // 00034 (OD-2): with the teams out, the promoted player took the leaver's slot.
      if (!p.team) return text
      const position = positionName(p.position, t)
      const slot = position ? `${teamName(p.team, t)} (${position})` : teamName(p.team, t)
      return `${text} ${t(inApp ? `${lk}promotedTeamYou` : `${lk}promotedTeam`, { slot })}`
    }
    case 'teams_created':
      return t(`${k}teamsCreated`, {
        dark: (event.payload.dark_team_names ?? []).join(', ') || '—',
        light: (event.payload.light_team_names ?? []).join(', ') || '—',
      })
    case 'match_reminder': {
      const p = event.payload
      let day = t(`${k}reminderToday`)
      let time = p.time
      if (p.date_time && Number.isFinite(Date.parse(p.date_time))) {
        time = formatMatchTime(p.date_time, timeZone)
        const days = calendarDaysFromNow(p.date_time, timeZone, options.now)
        day =
          days <= 0
            ? t(`${k}reminderToday`)
            : days === 1
              ? t(`${k}reminderTomorrow`)
              : formatMatchDateShort(p.date_time, timeZone, language)
      }
      const text = t(`${k}reminder`, { day, time, location: atLocation(p.location, t), group: p.group_name })
      // Older rows have no has_teams: keep the shirt line they always had.
      return p.has_teams === false ? text : `${text} ${t(`${k}reminderShirts`)}`
    }
    case 'match_cancelled': {
      const { date, time } = formatDateTime(event.payload.date_time, timeZone, language)
      return t(`${k}matchCancelled`, {
        date,
        time,
        location: atLocation(event.payload.location, t),
        group: event.payload.group_name,
      })
    }
    case 'match_updated': {
      const p = event.payload
      const { date, time } = formatDateTime(p.date_time, timeZone, language)
      if (p.date_changed !== false && p.previous_date_time) {
        const prev = formatDateTime(p.previous_date_time, timeZone, language)
        return t(`${k}matchUpdatedWhen`, {
          group: p.group_name,
          oldDate: prev.date,
          oldTime: prev.time,
          date,
          time,
          location: atLocation(p.location, t),
        })
      }
      return t(`${k}matchUpdatedWhere`, {
        date,
        time,
        group: p.group_name,
        place: p.location || t(`${k}noLocation`),
      })
    }
    case 'lineup_changed': {
      const p = event.payload
      const { date, time } = formatDateTime(p.date_time, timeZone, language)
      const left = playerNames(p.left)
      const promoted = playerNames(p.promoted)
      const swaps = p.swaps ?? []
      const params = { names: joinList(left, t), date, time, group: p.group_name }
      const many = left.length > 1

      // Late drop-out before the teams (OD-11): who left and who came in.
      if (p.phase === 'late') {
        const head = t(many ? `${lk}lateLeftMany` : `${lk}lateLeftOne`, params)
        const tail =
          promoted.length > 0
            ? t(`${lk}latePromoted`, { names: joinList(promoted, t) })
            : typeof p.spots_left === 'number' && p.spots_left > 0
              ? plural(t, `${lk}lateNoPromoted`, p.spots_left)
              : ''
        return [head, tail].filter(Boolean).join(' ')
      }

      const head = t(many ? `${k}lineupLeftMany` : `${k}lineupLeftOne`, params)
      // Promoted players took the leavers' slots (OD-2): say who replaced
      // whom, and only ask for a review when a gap is left.
      if (swaps.length > 0) {
        const swapText =
          swaps.length === 1 && left.length === 1
            ? t(`${lk}swapOne`, { in: swaps[0].in, team: teamName(swaps[0].team, t) })
            : t(`${lk}swapMany`, {
                pairs: joinList(
                  swaps.map((sw) => t(`${lk}swapPair`, { in: sw.in, left: sw.left, team: teamName(sw.team, t) })),
                  t
                ),
              })
        const review = p.needs_review ? t(`${k}lineupNoPromoted`) : t(`${lk}teamsOk`)
        return `${head} ${swapText} ${review}`
      }
      const tail =
        promoted.length > 0
          ? t(`${k}lineupPromoted`, { names: joinList(promoted, t) })
          : typeof p.spots_left === 'number' && p.spots_left > 0
            ? plural(t, `${k}lineupNoPromoted`, p.spots_left)
            : t(`${k}lineupNoPromoted`)
      return `${head} ${tail}`
    }
    case 'results_posted': {
      const p = event.payload
      const parts: string[] = [t(`${k}resultsScore`, { dark: p.dark_score, light: p.light_score })]
      const scorers = (p.scorers ?? []).filter((s) => s.goals > 0)
      if (scorers.length > 0) {
        parts.push(
          t(`${k}resultsGoals`, {
            names: joinNames(scorers.map((s) => (s.goals > 1 ? `${s.name} (${s.goals})` : s.name))),
          })
        )
      }
      const assisters = (p.assisters ?? []).filter((a) => a.assists > 0)
      if (assisters.length > 0) {
        parts.push(
          t(`${k}resultsAssists`, {
            names: joinNames(assisters.map((a) => (a.assists > 1 ? `${a.name} (${a.assists})` : a.name))),
          })
        )
      }
      const unattributed = (p.unattributed?.dark ?? 0) + (p.unattributed?.light ?? 0)
      if (unattributed > 0) {
        parts.push(plural(t, `${k}unattributed`, unattributed))
      }
      if (p.mvp_name) {
        parts.push(t(`${k}resultsMvp`, { name: p.mvp_name }))
      }
      if (p.status === 'consensus') {
        parts.push(t(`${k}resultsConsensus`))
      }
      return parts.join(' ')
    }
    case 'results_request': {
      const { date } = formatDateTime(event.payload.date_time, timeZone, language)
      const link = withLink ? `: ${resolveReportUrl(event.payload.report_url)}` : '.'
      return t(`${k}resultsRequest`, { date, group: event.payload.group_name, link })
    }
    case 'results_reminder': {
      const { date } = formatDateTime(event.payload.date_time, timeZone, language)
      const names = event.payload.pending_player_names ?? []
      const who = names.length > 0 ? t(`${k}resultsReminderWho`, { names: joinNames(names) }) : ''
      const link = withLink ? `: ${resolveReportUrl(event.payload.report_url)}` : '.'
      return t(`${k}resultsReminder`, { date, group: event.payload.group_name, who, link })
    }
    case 'results_needs_review': {
      const { date } = formatDateTime(event.payload.date_time, timeZone, language)
      return t(`${k}resultsNeedsReview`, { date, group: event.payload.group_name })
    }
    case 'rate_new_member':
      return t(`${k}rateNewMember`, { name: event.payload.player_name })
    case 'results_changed': {
      const { date } = formatDateTime(event.payload.date_time, timeZone, language)
      const mvp = event.payload.mvp_name ? t(`${k}resultsChangedMvp`, { name: event.payload.mvp_name }) : ''
      return t(`${k}resultsChanged`, {
        date,
        group: event.payload.group_name,
        previous: event.payload.previous_score,
        current: event.payload.current_score,
        mvp,
      })
    }
    case 'member_score_dropped': {
      const p = event.payload
      const window = p.breakdown?.window_matches ?? 10
      const issues = describeScoreIssues(p.breakdown, t)
      const why = issues.length > 0 ? t(`${k}scoreDroppedWhy`, { issues: joinList(issues, t), window }) : ''
      return t(`${k}scoreDropped`, {
        group: p.group_name,
        score: formatScore(p.score),
        threshold: formatScore(p.threshold),
        why,
        window,
      })
    }
    case 'member_score_recovered': {
      const p = event.payload
      if (p.score === null) {
        return t(`${k}scoreRecoveredNew`, { group: p.group_name })
      }
      return t(`${k}scoreRecovered`, { group: p.group_name, score: formatScore(p.score) })
    }
    default: {
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}
