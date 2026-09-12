import { DEFAULT_TIMEZONE, formatMatchDateShort, formatMatchTime } from '@/lib/utils/datetime'

export interface AnnouncementInput {
  groupName: string
  dateTime: string
  location: string | null
  confirmedCount: number
  maxPlayers: number
  matchId: string
  timeZone?: string
}

// Builds the Spanish WhatsApp-ready announcement text for a match (see
// docs/rework-plan.md §2.4). No client directive: the group dashboard (a
// server page) builds the wa.me link from it, and MatchAnnouncement renders
// it on the client. Uses the zone-aware formatters (with an explicit
// timeZone) so both agree byte for byte.
export function buildAnnouncementText({
  groupName,
  dateTime,
  location,
  confirmedCount,
  maxPlayers,
  matchId,
  timeZone = DEFAULT_TIMEZONE,
}: AnnouncementInput) {
  const dayLabel = formatMatchDateShort(dateTime, timeZone)
  const timeLabel = formatMatchTime(dateTime, timeZone)
  const spotsLeft = Math.max(0, maxPlayers - confirmedCount)
  const spotsLabel = spotsLeft > 0 ? `faltan ${spotsLeft} lugares` : 'no quedan lugares'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const signupUrl = `${appUrl}/m/${matchId}`

  return (
    `⚽ ${groupName} — ${dayLabel} ${timeLabel}\n` +
    (location ? `📍 ${location}\n` : '') +
    `👥 ${confirmedCount}/${maxPlayers} anotados — ${spotsLabel}\n` +
    `👉 Anotate acá: ${signupUrl}\n` +
    `Remera oscura/clara según tu equipo.`
  )
}
