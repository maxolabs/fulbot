'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Star, X, UserX, RotateCcw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Database, WaitlistReason } from '@/types/database'
import { useT } from '@/i18n/provider'

interface Signup {
  id: string
  status: string
  signup_time: string
  position_preference: string | null
  notes: string | null
  waitlist_position: number | null
  waitlist_reason?: WaitlistReason | null
  player_id: string | null
  guest_player_id: string | null
  player_profiles: {
    id: string
    display_name: string
    nickname: string | null
    main_position: string
  } | null
  guest_players: {
    id: string
    display_name: string
    notes?: string | null
    estimated_rating?: number
    preferred_positions?: string[]
  } | null
}

interface SignupListProps {
  signups: Signup[]
  currentPlayerId: string
  showWaitlistPosition?: boolean
  emptyMessage: string
  isAdminOrCaptain?: boolean
  matchStatus?: string
  badgesByPlayer?: Record<string, string[]>
  // Overall score per player id; only provided to admins/captains
  ratingsById?: Record<string, number>
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

const BADGE_ICONS: Record<string, string> = {
  hat_trick: '⚽',
  playmaker: '🎯',
  safe_hands: '🧤',
  ironman: '💪',
  mvp: '🏆',
}

// Why a waitlisted member is there (docs/member-scoring.md §10.4). Shown to
// admins/captains only; the member gets the long form in SignupActions.
const REASON_TAG_CLASS: Record<WaitlistReason, string> = {
  priority_window: 'border-yellow-500/40 text-yellow-700 dark:text-yellow-500',
  reserved: 'border-yellow-500/40 text-yellow-700 dark:text-yellow-500',
  cooldown: 'border-destructive/40 text-destructive',
  full: '',
}

export function SignupList({
  signups,
  currentPlayerId,
  showWaitlistPosition,
  emptyMessage,
  isAdminOrCaptain,
  matchStatus,
  badgesByPlayer,
  ratingsById,
}: SignupListProps) {
  const router = useRouter()
  const supabase = createClient()
  const t = useT()
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const canToggleNoShow = isAdminOrCaptain && matchStatus === 'finished'

  const handleRemove = async (signupId: string, displayName: string) => {
    if (!confirm(`¿Seguro que querés sacar a ${displayName} del partido?`)) {
      return
    }

    setRemovingId(signupId)

    try {
      const args: Database['public']['Functions']['admin_remove_signup']['Args'] = {
        p_signup_id: signupId,
      }
      const { error } = await supabase.rpc('admin_remove_signup', args)

      if (error) throw error

      router.refresh()
    } catch (err) {
      console.error('Error removing signup:', err)
      alert('Error al sacar del partido')
    } finally {
      setRemovingId(null)
    }
  }

  const handleToggleNoShow = async (signupId: string, currentStatus: string) => {
    setTogglingId(signupId)

    try {
      const newStatus: Database['public']['Enums']['signup_status'] =
        currentStatus === 'did_not_show' ? 'confirmed' : 'did_not_show'
      const args: Database['public']['Functions']['admin_set_signup_status']['Args'] = {
        p_signup_id: signupId,
        p_status: newStatus,
      }
      const { error } = await supabase.rpc('admin_set_signup_status', args)

      if (error) throw error

      router.refresh()
    } catch (err) {
      console.error('Error updating attendance:', err)
      alert('Error al actualizar la asistencia')
    } finally {
      setTogglingId(null)
    }
  }

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
        const guest = signup.guest_players

        if (!player && !guest) return null

        const isGuest = !!guest && !player
        const displayName = player?.display_name || guest?.display_name || 'Desconocido'
        const isCurrentUser = !isGuest && player?.id === currentPlayerId
        const isNoShow = signup.status === 'did_not_show'
        const badges = (player && badgesByPlayer?.[player.id]) || []

        return (
          <div
            key={signup.id}
            className={`flex items-center gap-3 p-3 rounded-lg ${
              isCurrentUser ? 'bg-primary/5 border border-primary/20' : 'hover:bg-muted/50'
            } ${isNoShow ? 'opacity-60' : ''}`}
          >
            {showWaitlistPosition && (
              <span className="w-6 text-center text-sm font-medium text-muted-foreground">
                #{signup.waitlist_position || index + 1}
              </span>
            )}

            <Avatar fallback={displayName} size="sm" />

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`text-sm font-medium truncate ${isCurrentUser ? 'text-primary' : ''}`}>
                  {displayName}
                  {player?.nickname && (
                    <span className="text-muted-foreground ml-1">({player.nickname})</span>
                  )}
                </span>
                {isCurrentUser && (
                  <Badge variant="secondary" className="text-xs">Tú</Badge>
                )}
                {isGuest && (
                  <Badge variant="outline" className="text-xs">Invitado</Badge>
                )}
                {isNoShow && (
                  <Badge variant="outline" className="text-xs">No vino</Badge>
                )}
                {isAdminOrCaptain && signup.status === 'waitlist' && signup.waitlist_reason && (
                  <Badge
                    variant="outline"
                    className={`text-xs shrink-0 whitespace-nowrap ${REASON_TAG_CLASS[signup.waitlist_reason] ?? ''}`}
                  >
                    {t(`signupPolicy.tag.${signup.waitlist_reason}`)}
                  </Badge>
                )}
                {badges.length > 0 && (
                  <span className="flex items-center gap-0.5 text-sm" title={badges.join(', ')}>
                    {badges.slice(0, 3).map((badgeType, i) => (
                      <span key={i}>{BADGE_ICONS[badgeType] || '🏅'}</span>
                    ))}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {player ? (
                  <>
                    <span>{POSITION_LABELS[player.main_position] || player.main_position}</span>
                    {ratingsById?.[player.id] !== undefined && (
                      <span className="flex items-center gap-0.5">
                        <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                        {ratingsById[player.id].toFixed(1)}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span>
                      {guest?.preferred_positions?.[0]
                        ? POSITION_LABELS[guest.preferred_positions[0]] || guest.preferred_positions[0]
                        : 'Jugador invitado'}
                    </span>
                    {typeof guest?.estimated_rating === 'number' && (
                      <span className="flex items-center gap-0.5" title="Nivel estimado">
                        <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                        {guest.estimated_rating.toFixed(1)}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>

            {signup.notes && (
              <span className="text-xs text-muted-foreground max-w-[100px] truncate">
                {signup.notes}
              </span>
            )}

            {canToggleNoShow && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => handleToggleNoShow(signup.id, signup.status)}
                disabled={togglingId === signup.id}
                title={isNoShow ? 'Marcar como presente' : 'Marcar que no vino'}
              >
                {togglingId === signup.id ? (
                  <Spinner size="sm" />
                ) : isNoShow ? (
                  <RotateCcw className="h-4 w-4" />
                ) : (
                  <UserX className="h-4 w-4" />
                )}
              </Button>
            )}

            {isAdminOrCaptain && !isNoShow && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => handleRemove(signup.id, displayName)}
                disabled={removingId === signup.id}
                title="Sacar del partido"
              >
                {removingId === signup.id ? <Spinner size="sm" /> : <X className="h-4 w-4" />}
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}
