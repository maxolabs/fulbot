import { ImageResponse } from '@vercel/og'
import { NextRequest } from 'next/server'
import { placePlayersInFormation } from '@/lib/formations'
import { CHALK, CONE, PITCH, TEAM_DARK, TEAM_LIGHT, TEAM_LIGHT_INK } from '@/lib/brand'
import { getTranslation, type Language } from '@/i18n/core'

export const runtime = 'edge'

// Exported lineup image (docs/ui-rework/01-brand.md §6): the same board as the
// web pitch so the WhatsApp image is recognisably the app. Board canvas,
// dashed chalk markings drawn as bordered divs (Satori has no SVG dasharray),
// wordmark + match date in the header, 44px dots with initials in Syne 800
// and the name below in IBM Plex Mono. Ratings never appear here: the image
// goes to the whole group.
//
// Fonts are the two OFL files in src/assets/fonts, resolved relative to this
// module so they work in `next dev` and `next build` on the edge runtime.
// No system-ui fallback: every text node names one of the two faces.

const WIDTH = 820
const HEIGHT = 660
const FIELD_W = 380
const FIELD_H = 500
const DOT = 44

interface Player {
  name: string
  position: string
}

interface LineupData {
  groupName: string
  matchDate: string
  darkTeam: Player[]
  lightTeam: Player[]
  lang?: Language
}

const fontFiles = {
  syne: new URL('../../../../assets/fonts/Syne-ExtraBold.ttf', import.meta.url),
  mono: new URL('../../../../assets/fonts/IBMPlexMono-Medium.ttf', import.meta.url),
}

async function loadFonts() {
  const [syne, mono] = await Promise.all([
    fetch(fontFiles.syne).then((r) => r.arrayBuffer()),
    fetch(fontFiles.mono).then((r) => r.arrayBuffer()),
  ])
  return [
    { name: 'Syne', data: syne, weight: 800 as const, style: 'normal' as const },
    { name: 'IBM Plex Mono', data: mono, weight: 500 as const, style: 'normal' as const },
  ]
}

function initialsOf(name: string): string {
  return name.trim().slice(0, 2).toUpperCase()
}

// Satori only dashes a border drawn on ONE side of a box (a four-sided
// dashed border comes out solid), so every straight marking is a zero-size
// div with a single dashed edge, and the centre circle is an inline SVG.
function HLine({ x, y, w }: { x: number; y: number; w: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y - 1,
        width: w,
        height: 0,
        borderTopWidth: '2px',
        borderTopStyle: 'dashed',
        borderTopColor: CHALK,
      }}
    />
  )
}

function VLine({ x, y, h }: { x: number; y: number; h: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x - 1,
        top: y,
        width: 0,
        height: h,
        borderLeftWidth: '2px',
        borderLeftStyle: 'dashed',
        borderLeftColor: CHALK,
      }}
    />
  )
}

function Markings() {
  const inset = 8
  const boxW = FIELD_W * 0.5
  const boxH = FIELD_H * 0.16
  const bx = (FIELD_W - boxW) / 2
  const r = 46
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
      {/* Outline */}
      <HLine x={inset} y={inset} w={FIELD_W - inset * 2} />
      <HLine x={inset} y={FIELD_H - inset} w={FIELD_W - inset * 2} />
      <VLine x={inset} y={inset} h={FIELD_H - inset * 2} />
      <VLine x={FIELD_W - inset} y={inset} h={FIELD_H - inset * 2} />
      {/* Halfway line */}
      <HLine x={inset} y={FIELD_H / 2} w={FIELD_W - inset * 2} />
      {/* Top box (shares its top edge with the outline) */}
      <HLine x={bx} y={inset + boxH} w={boxW} />
      <VLine x={bx} y={inset} h={boxH} />
      <VLine x={bx + boxW} y={inset} h={boxH} />
      {/* Bottom box */}
      <HLine x={bx} y={FIELD_H - inset - boxH} w={boxW} />
      <VLine x={bx} y={FIELD_H - inset - boxH} h={boxH} />
      <VLine x={bx + boxW} y={FIELD_H - inset - boxH} h={boxH} />
      {/* Centre circle */}
      <svg
        width={r * 2 + 4}
        height={r * 2 + 4}
        viewBox={`0 0 ${r * 2 + 4} ${r * 2 + 4}`}
        style={{ position: 'absolute', left: FIELD_W / 2 - r - 2, top: FIELD_H / 2 - r - 2 }}
      >
        <circle cx={r + 2} cy={r + 2} r={r} fill="none" stroke={CHALK} strokeWidth="2" strokeDasharray="6 4" />
      </svg>
    </div>
  )
}

function Dot({ player, x, y, dark }: { player: Player; x: number; y: number; dark: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        transform: 'translate(-50%, -50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '3px',
      }}
    >
      <div
        style={{
          width: DOT,
          height: DOT,
          borderRadius: '50%',
          backgroundColor: dark ? TEAM_DARK : TEAM_LIGHT,
          border: `2px solid ${CHALK}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: dark ? TEAM_LIGHT : TEAM_LIGHT_INK,
          fontFamily: 'Syne',
          fontWeight: 800,
          fontSize: '15px',
          letterSpacing: '-0.02em',
        }}
      >
        {initialsOf(player.name)}
      </div>
      <div
        style={{
          fontFamily: 'IBM Plex Mono',
          fontWeight: 500,
          fontSize: '13px',
          color: TEAM_LIGHT,
          whiteSpace: 'nowrap',
          maxWidth: '96px',
          overflow: 'hidden',
          textShadow: '0 1px 2px rgba(0,0,0,0.7)',
        }}
      >
        {player.name}
      </div>
    </div>
  )
}

function Field({
  players,
  dark,
  teamName,
  countLabel,
  emptyLabel,
}: {
  players: Player[]
  dark: boolean
  teamName: string
  countLabel: string
  emptyLabel: string
}) {
  const placed = placePlayersInFormation(players)

  return (
    <div style={{ width: FIELD_W, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Team panel */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          height: '44px',
          padding: '0 14px',
          borderRadius: '4px',
          backgroundColor: dark ? TEAM_DARK : TEAM_LIGHT,
          color: dark ? TEAM_LIGHT : TEAM_LIGHT_INK,
        }}
      >
        <span style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: '18px', letterSpacing: '-0.01em' }}>
          {teamName}
        </span>
        <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 500, fontSize: '13px' }}>{countLabel}</span>
      </div>

      {/* Board */}
      <div
        style={{
          position: 'relative',
          width: FIELD_W,
          height: FIELD_H,
          borderRadius: '2px',
          backgroundColor: PITCH,
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        <Markings />
        {placed.map(({ player, slot }, i) => (
          <Dot key={i} player={player} x={slot.x} y={slot.y} dark={dark} />
        ))}
        {players.length === 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: CHALK,
              fontFamily: 'IBM Plex Mono',
              fontSize: '14px',
            }}
          >
            {emptyLabel}
          </div>
        )}
      </div>
    </div>
  )
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const dataParam = searchParams.get('data')

  if (!dataParam) {
    return new Response('Missing data parameter', { status: 400 })
  }

  let data: LineupData
  try {
    data = JSON.parse(decodeURIComponent(dataParam))
  } catch {
    return new Response('Invalid data parameter', { status: 400 })
  }

  const { groupName, matchDate, darkTeam = [], lightTeam = [] } = data
  const t = getTranslation(data.lang === 'en' ? 'en' : 'es')
  const countLabel = (n: number) =>
    n === 1 ? t('ui.teamsScreen.playersOne') : t('ui.teamsScreen.players', { n })
  const fonts = await loadFonts()

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: PITCH,
          padding: '24px',
          fontFamily: 'IBM Plex Mono',
          color: TEAM_LIGHT,
        }}
      >
        {/* Header: wordmark left, group + date right */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            height: '40px',
            marginBottom: '16px',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontFamily: 'Syne',
              fontWeight: 800,
              fontSize: '30px',
              letterSpacing: '-0.01em',
              lineHeight: 1,
            }}
          >
            <span style={{ color: TEAM_LIGHT }}>ful</span>
            <span style={{ color: CONE }}>bot</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
            <span style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: '16px', color: TEAM_LIGHT }}>
              {groupName}
            </span>
            <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 500, fontSize: '14px', color: CHALK }}>
              {matchDate}
            </span>
          </div>
        </div>

        {/* Boards */}
        <div style={{ display: 'flex', gap: '12px', flex: 1 }}>
          <Field
            players={darkTeam}
            dark
            teamName={t('ui.teamsScreen.dark')}
            countLabel={countLabel(darkTeam.length)}
            emptyLabel={t('ui.teamsScreen.empty')}
          />
          <Field
            players={lightTeam}
            dark={false}
            teamName={t('ui.teamsScreen.light')}
            countLabel={countLabel(lightTeam.length)}
            emptyLabel={t('ui.teamsScreen.empty')}
          />
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      fonts,
    }
  )
}
