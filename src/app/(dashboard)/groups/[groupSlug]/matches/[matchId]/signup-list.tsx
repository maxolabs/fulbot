'use client'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Star } from 'lucide-react'

interface Signup {
  id: string
  status: string
  signup_time: string
  position_preference: string | null
  notes: string | null
  waitlist_position: number | null
  player_profiles: {
    id: string
    display_name: string
    nickname: string | null
    main_position: string
    overall_rating: number
  } | null
}

interface SignupListProps {
  signups: Signup[]
  currentPlayerId: string
  showWaitlistPosition?: boolean
  emptyMessage: string
}

const POSITION_LABELS: Record<string, string> = {
  GK: 'Arquero',
  CB: 'Defensor',
  LB: 'Lat. Izq.',
  RB: 'Lat. Der.',
  CDM: 'Vol. Def.',
  CM: 'Mediocampista',
  CAM: 'Enganche',
  LM: 'Medio Izq.',
  RM: 'Medio Der.',
  LW: 'Extremo Izq.',
  RW: 'Extremo Der.',
  ST: 'Delantero',
  CF: 'Centro Del.',
}

export function SignupList({
  signups,
  currentPlayerId,
  showWaitlistPosition,
  emptyMessage,
}: SignupListProps) {
  if (signups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        {emptyMessage}
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {signups.map((signup, index) => {
        const player = signup.player_profiles
        if (!player) return null

        const isCurrentUser = player.id === currentPlayerId

        return (
          <div
            key={signup.id}
            className={`flex items-center gap-3 p-3 rounded-lg ${
              isCurrentUser ? 'bg-primary/5 border border-primary/20' : 'hover:bg-muted/50'
            }`}
          >
            {showWaitlistPosition && (
              <span className="w-6 text-center text-sm font-medium text-muted-foreground">
                #{signup.waitlist_position || index + 1}
              </span>
            )}

            <Avatar fallback={player.display_name} size="sm" />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium truncate ${isCurrentUser ? 'text-primary' : ''}`}>
                  {player.display_name}
                  {player.nickname && (
                    <span className="text-muted-foreground ml-1">({player.nickname})</span>
                  )}
                </span>
                {isCurrentUser && (
                  <Badge variant="secondary" className="text-xs">Tú</Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{POSITION_LABELS[player.main_position] || player.main_position}</span>
                <span className="flex items-center gap-0.5">
                  <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                  {player.overall_rating.toFixed(1)}
                </span>
              </div>
            </div>

            {signup.notes && (
              <span className="text-xs text-muted-foreground max-w-[100px] truncate">
                {signup.notes}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
