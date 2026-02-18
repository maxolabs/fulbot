'use client'

import { Star } from 'lucide-react'

interface Player {
  id: string
  displayName: string
  nickname: string | null
  mainPosition: string
  overallRating: number
  position: string
  assignmentId: string
}

interface LineupFieldProps {
  players: Player[]
  teamColor: 'dark' | 'light'
}

// Position coordinates on the field (as percentages)
// These are for a vertical field layout
const POSITION_COORDS: Record<string, { x: number; y: number }> = {
  // Goalkeeper
  GK: { x: 50, y: 90 },
  // Defenders
  CB: { x: 50, y: 75 },
  LB: { x: 20, y: 70 },
  RB: { x: 80, y: 70 },
  // Defensive Midfielders
  CDM: { x: 50, y: 55 },
  // Midfielders
  LM: { x: 15, y: 50 },
  CM: { x: 50, y: 45 },
  RM: { x: 85, y: 50 },
  CAM: { x: 50, y: 35 },
  // Wingers
  LW: { x: 20, y: 25 },
  RW: { x: 80, y: 25 },
  // Forwards
  ST: { x: 50, y: 15 },
  CF: { x: 50, y: 20 },
}

// Stack multiple players in same position
function getPlayerPosition(
  position: string,
  index: number,
  totalInPosition: number
): { x: number; y: number } {
  const baseCoords = POSITION_COORDS[position] || { x: 50, y: 50 }

  if (totalInPosition <= 1) {
    return baseCoords
  }

  // Offset players horizontally if multiple in same position
  const offset = (index - (totalInPosition - 1) / 2) * 15
  return {
    x: Math.max(10, Math.min(90, baseCoords.x + offset)),
    y: baseCoords.y,
  }
}

export function LineupField({ players, teamColor }: LineupFieldProps) {
  // Group players by position
  const playersByPosition = players.reduce((acc, player) => {
    if (!acc[player.position]) {
      acc[player.position] = []
    }
    acc[player.position].push(player)
    return acc
  }, {} as Record<string, Player[]>)

  // Calculate positions for each player
  const positionedPlayers = players.map((player) => {
    const samePositionPlayers = playersByPosition[player.position]
    const index = samePositionPlayers.indexOf(player)
    const coords = getPlayerPosition(player.position, index, samePositionPlayers.length)
    return { ...player, coords }
  })

  const isDark = teamColor === 'dark'

  return (
    <div
      className="relative w-full aspect-[3/4] rounded-lg overflow-hidden"
      style={{
        background: 'linear-gradient(to bottom, #2d5a27 0%, #3a7233 50%, #2d5a27 100%)',
      }}
    >
      {/* Field markings */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
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
        <circle
          cx="50"
          cy="50"
          r="12"
          fill="none"
          stroke="rgba(255,255,255,0.4)"
          strokeWidth="0.5"
        />
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
      {positionedPlayers.map((player) => (
        <div
          key={player.id}
          className="absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1"
          style={{
            left: `${player.coords.x}%`,
            top: `${player.coords.y}%`,
          }}
        >
          {/* Player circle */}
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shadow-lg border-2 ${
              isDark
                ? 'bg-gray-800 text-white border-gray-600'
                : 'bg-gray-100 text-gray-900 border-gray-400 shadow-white/30'
            }`}
          >
            {player.position}
          </div>
          {/* Player name */}
          <div
            className={`px-2 py-0.5 rounded text-[10px] font-medium max-w-[80px] truncate ${
              isDark ? 'bg-gray-800/90 text-white' : 'bg-gray-100/95 text-gray-900'
            }`}
          >
            {player.nickname || player.displayName.split(' ')[0]}
          </div>
          {/* Rating badge */}
          <div className="flex items-center gap-0.5 text-[10px] text-yellow-400">
            <Star className="h-2.5 w-2.5 fill-yellow-400" />
            {player.overallRating.toFixed(1)}
          </div>
        </div>
      ))}

      {/* Empty state */}
      {players.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-white/60 text-sm">Sin jugadores asignados</p>
        </div>
      )}
    </div>
  )
}
