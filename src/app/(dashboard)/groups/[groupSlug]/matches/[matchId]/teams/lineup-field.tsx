'use client'

import { Star } from 'lucide-react'
import { placePlayersInFormation } from '@/lib/formations'

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

export function LineupField({ players, teamColor }: LineupFieldProps) {
  // Slot every player into the fixed formation for this team size
  const positionedPlayers = placePlayersInFormation(players).map(({ player, slot }) => ({
    ...player,
    slotPosition: slot.position,
    coords: { x: slot.x, y: slot.y },
  }))

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
            {player.slotPosition}
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
