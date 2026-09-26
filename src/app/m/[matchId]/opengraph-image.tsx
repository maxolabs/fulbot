import { ImageResponse } from '@vercel/og'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { CHALK, CONE, PITCH, TEAM_LIGHT } from '@/lib/brand'
import { getTranslation, type Language } from '@/i18n/core'
import { DEFAULT_TIMEZONE, formatMatchTime } from '@/lib/utils/datetime'
import { formatRowDate } from '@/app/(dashboard)/groups/[groupSlug]/matches/match-format'

export const runtime = 'edge'
export const alt = 'fulbot'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// WhatsApp / social preview of the public match link (PLAT-8): the board,
// the group, the date in the group's time zone, time · location and the
// spots. Only what get_public_match already shows anonymously: no names, no
// ratings. Same two OFL faces as the lineup export.

const fontFiles = {
  syne: new URL('../../../assets/fonts/Syne-ExtraBold.ttf', import.meta.url),
  mono: new URL('../../../assets/fonts/IBMPlexMono-Medium.ttf', import.meta.url),
}

interface PublicMatchSummary {
  id: string
  group_name: string
  date_time: string
  location: string | null
  status: string
  max_players: number
  confirmed_count: number
  waitlist_count: number
  timezone: string | null
}

function clip(value: string, max: number): string {
  const clean = value.trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

export default async function Image({ params }: { params: { matchId: string } }) {
  const cookieStore = await cookies()
  const language: Language = cookieStore.get('fulbot_lang')?.value === 'en' ? 'en' : 'es'
  const t = getTranslation(language)

  const [syne, mono] = await Promise.all([
    fetch(fontFiles.syne).then((r) => r.arrayBuffer()),
    fetch(fontFiles.mono).then((r) => r.arrayBuffer()),
  ])
  const fonts = [
    { name: 'Syne', data: syne, weight: 800 as const, style: 'normal' as const },
    { name: 'IBM Plex Mono', data: mono, weight: 500 as const, style: 'normal' as const },
  ]

  let match: PublicMatchSummary | null = null
  try {
    const supabase = await createClient()
    const { data } = (await supabase.rpc('get_public_match', { p_match_id: params.matchId })) as {
      data: PublicMatchSummary | null
    }
    match = data?.id ? data : null
  } catch (error) {
    console.error('opengraph-image: could not load match', error)
  }

  const wordmark = (
    <div style={{ display: 'flex', fontFamily: 'Syne', fontSize: 44, letterSpacing: '-0.01em' }}>
      <span style={{ color: TEAM_LIGHT }}>ful</span>
      <span style={{ color: CONE }}>bot</span>
    </div>
  )

  if (!match) {
    return new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: PITCH }}>
          {wordmark}
        </div>
      ),
      { ...size, fonts }
    )
  }

  const timeZone = match.timezone || DEFAULT_TIMEZONE
  const date = new Date(match.date_time)
  const confirmed = Math.min(match.confirmed_count, match.max_players)
  const fill = match.max_players > 0 ? confirmed / match.max_players : 0
  const isFull = match.confirmed_count >= match.max_players
  const statusLabel = match.status === 'signup_closed'
    ? t('ui.screens.publicMatch.signupClosed')
    : isFull || match.status === 'full'
      ? t('ui.spots.full')
      : match.status === 'signup_open'
        ? t('ui.screens.publicMatch.signupOpen')
        : ''
  const meta = [formatMatchTime(date, timeZone), match.location ? clip(match.location, 40) : null]
    .filter(Boolean)
    .join(' · ')

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          backgroundColor: PITCH,
          color: TEAM_LIGHT,
        }}
      >
        {wordmark}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 28, textTransform: 'uppercase', letterSpacing: '0.12em', color: CHALK }}>
            {clip(match.group_name, 40)}
          </div>
          <div style={{ fontFamily: 'Syne', fontSize: 104, lineHeight: 1, letterSpacing: '-0.02em' }}>
            {formatRowDate(t, date, timeZone)}
          </div>
          <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 36, color: CHALK }}>{meta}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'IBM Plex Mono', fontSize: 30 }}>
            <span>{`${match.confirmed_count} / ${match.max_players}`}</span>
            <span style={{ color: CHALK }}>{statusLabel}</span>
          </div>
          <div style={{ display: 'flex', width: '100%', height: 16, backgroundColor: 'rgba(243,240,230,.15)', borderRadius: 3 }}>
            <div style={{ display: 'flex', width: `${Math.round(fill * 100)}%`, height: 16, backgroundColor: isFull ? TEAM_LIGHT : CONE, borderRadius: 3 }} />
          </div>
        </div>
      </div>
    ),
    { ...size, fonts }
  )
}
