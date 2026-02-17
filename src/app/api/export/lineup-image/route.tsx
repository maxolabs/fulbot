import { ImageResponse } from '@vercel/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

interface Player {
  name: string
  position: string
  rating: number
}

interface LineupData {
  groupName: string
  matchDate: string
  darkTeam: Player[]
  lightTeam: Player[]
}

// Position coordinates on the field (as percentages)
const POSITION_COORDS: Record<string, { x: number; y: number }> = {
  GK: { x: 50, y: 88 },
  CB: { x: 50, y: 72 },
  LB: { x: 18, y: 68 },
  RB: { x: 82, y: 68 },
  CDM: { x: 50, y: 55 },
  LM: { x: 15, y: 48 },
  CM: { x: 50, y: 45 },
  RM: { x: 85, y: 48 },
  CAM: { x: 50, y: 35 },
  LW: { x: 18, y: 25 },
  RW: { x: 82, y: 25 },
  ST: { x: 50, y: 15 },
  CF: { x: 50, y: 20 },
}

function getPlayerPosition(
  position: string,
  index: number,
  totalInPosition: number
): { x: number; y: number } {
  const baseCoords = POSITION_COORDS[position] || { x: 50, y: 50 }

  if (totalInPosition <= 1) {
    return baseCoords
  }

  const offset = (index - (totalInPosition - 1) / 2) * 15
  return {
    x: Math.max(10, Math.min(90, baseCoords.x + offset)),
    y: baseCoords.y,
  }
}

function PlayerCircle({
  player,
  x,
  y,
  isDark,
}: {
  player: Player
  x: number
  y: number
  isDark: boolean
}) {
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
        gap: '4px',
      }}
    >
      {/* Player circle */}
      <div
        style={{
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          backgroundColor: isDark ? '#1f2937' : '#ffffff',
          border: `3px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isDark ? '#ffffff' : '#1f2937',
          fontSize: '12px',
          fontWeight: 'bold',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}
      >
        {player.position}
      </div>
      {/* Player name */}
      <div
        style={{
          backgroundColor: isDark ? 'rgba(31,41,55,0.9)' : 'rgba(255,255,255,0.9)',
          color: isDark ? '#ffffff' : '#1f2937',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '11px',
          fontWeight: '500',
          maxWidth: '80px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {player.name}
      </div>
      {/* Rating */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          fontSize: '10px',
          color: '#fbbf24',
        }}
      >
        ★ {player.rating.toFixed(1)}
      </div>
    </div>
  )
}

function Field({
  players,
  isDark,
  teamName,
}: {
  players: Player[]
  isDark: boolean
  teamName: string
}) {
  // Group players by position
  const playersByPosition = players.reduce(
    (acc, player) => {
      if (!acc[player.position]) {
        acc[player.position] = []
      }
      acc[player.position].push(player)
      return acc
    },
    {} as Record<string, Player[]>
  )

  // Calculate positions
  const positionedPlayers = players.map((player) => {
    const samePos = playersByPosition[player.position]
    const idx = samePos.indexOf(player)
    const coords = getPlayerPosition(player.position, idx, samePos.length)
    return { ...player, coords }
  })

  const avgRating =
    players.length > 0 ? players.reduce((sum, p) => sum + p.rating, 0) / players.length : 0

  return (
    <div
      style={{
        width: '380px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {/* Team header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          backgroundColor: isDark ? '#1f2937' : '#f3f4f6',
          borderRadius: '8px',
          color: isDark ? '#ffffff' : '#1f2937',
        }}
      >
        <span style={{ fontSize: '18px', fontWeight: 'bold' }}>{teamName}</span>
        <span style={{ fontSize: '14px', opacity: 0.8 }}>
          {players.length} jugadores · {avgRating.toFixed(1)} avg
        </span>
      </div>

      {/* Field */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '480px',
          borderRadius: '12px',
          background: 'linear-gradient(to bottom, #2d5a27 0%, #3a7233 50%, #2d5a27 100%)',
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        {/* Field markings */}
        <svg
          width="380"
          height="480"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        >
          {/* Outer border */}
          <rect
            x="5"
            y="5"
            width="90"
            height="90"
            fill="none"
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="0.5"
          />
          {/* Center line */}
          <line
            x1="5"
            y1="50"
            x2="95"
            y2="50"
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="0.5"
          />
          {/* Center circle */}
          <circle cx="50" cy="50" r="12" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5" />
          {/* Top penalty area */}
          <rect
            x="25"
            y="5"
            width="50"
            height="18"
            fill="none"
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="0.5"
          />
          {/* Top goal area */}
          <rect
            x="35"
            y="5"
            width="30"
            height="8"
            fill="none"
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="0.5"
          />
          {/* Bottom penalty area */}
          <rect
            x="25"
            y="77"
            width="50"
            height="18"
            fill="none"
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="0.5"
          />
          {/* Bottom goal area */}
          <rect
            x="35"
            y="87"
            width="30"
            height="8"
            fill="none"
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="0.5"
          />
        </svg>

        {/* Players */}
        {positionedPlayers.map((player, i) => (
          <PlayerCircle
            key={i}
            player={player}
            x={player.coords.x}
            y={player.coords.y}
            isDark={isDark}
          />
        ))}

        {/* Empty state */}
        {players.length === 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255,255,255,0.6)',
              fontSize: '14px',
            }}
          >
            Sin jugadores asignados
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

  const { groupName, matchDate, darkTeam, lightTeam } = data

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#0f172a',
          padding: '24px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '28px', fontWeight: 'bold', color: '#ffffff' }}>
              ⚽ {groupName}
            </span>
            <span style={{ fontSize: '16px', color: '#94a3b8' }}>📅 {matchDate}</span>
          </div>
          <div
            style={{
              fontSize: '12px',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            Generado con Fulbot
          </div>
        </div>

        {/* Teams */}
        <div
          style={{
            display: 'flex',
            gap: '24px',
            flex: 1,
          }}
        >
          <Field players={darkTeam} isDark={true} teamName="Equipo Oscuro" />
          <Field players={lightTeam} isDark={false} teamName="Equipo Claro" />
        </div>
      </div>
    ),
    {
      width: 820,
      height: 630,
    }
  )
}
