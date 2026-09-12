'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { PlayerRow, PositionChip } from '@/components/ui/player-row'
import { Spinner } from '@/components/ui/spinner'
import { Star, X, UserX, RotateCcw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Database, WaitlistReason } from '@/types/database'
import { useLanguage, useT } from '@/i18n/provider'
import { cn } from '@/lib/utils/cn'

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
  // Overall score per player id; only provided to admins/captains
  ratingsById?: Record<string, number>
}

// Why a waitlisted member is there (docs/member-scoring.md §10.4). Shown to
// admins/captains only; the member gets the long form through the signup hook.
const REASON_BADGE_VARIANT: Record<WaitlistReason, 'warning' | 'destructive' | 'outline'> = {
  priority_window: 'warning',
  reserved: 'warning',
  cooldown: 'destructive',
  full: 'outline',
}

const iconButtonClassName =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50'

// Roster list (docs/ui-rework/03-screens.md §3): PlayerRow per signup with
// index, avatar, name, position chip; admin controls in the trailing slot.
export function SignupList({
  signups,
  currentPlayerId,
  showWaitlistPosition,
  emptyMessage,
  isAdminOrCaptain,
  matchStatus,
  ratingsById,
}: SignupListProps) {
  const router = useRouter()
  const supabase = createClient()
  const t = useT()
  const language = useLanguage()
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
    return <p className="py-2 text-sm text-muted-foreground">{emptyMessage}</p>
  }

  return (
    <ol className="[&>li:last-child>*]:border-b-0">
      {signups.map((signup, index) => {
        const player = signup.player_profiles
        const guest = signup.guest_players

        if (!player && !guest) return null

        const isGuest = !!guest && !player
        const displayName = player?.display_name || guest?.display_name || 'Desconocido'
        const isCurrentUser = !isGuest && player?.id === currentPlayerId
        const isNoShow = signup.status === 'did_not_show'
        const position = player?.main_position || guest?.preferred_positions?.[0] || null
        const rating = player ? ratingsById?.[player.id] : guest?.estimated_rating
        const ratingTitle = player ? undefined : t('ui.matchScreens.match.estimatedLevel')

        return (
          <li key={signup.id}>
            <PlayerRow
              index={showWaitlistPosition ? signup.waitlist_position || index + 1 : index + 1}
              name={displayName}
              nickname={player?.nickname}
              guest={isGuest}
              language={language}
              className={cn(isNoShow && 'opacity-50', isCurrentUser && 'font-semibold')}
              trailing={
                <>
                  {isCurrentUser && <Badge variant="secondary">{t('ui.matchScreens.match.you')}</Badge>}
                  {isNoShow && <Badge variant="outline">{t('ui.matchScreens.match.noShow')}</Badge>}
                  {isAdminOrCaptain && signup.status === 'waitlist' && signup.waitlist_reason && (
                    <Badge variant={REASON_BADGE_VARIANT[signup.waitlist_reason] ?? 'outline'}>
                      {t(`signupPolicy.tag.${signup.waitlist_reason}`)}
                    </Badge>
                  )}
                  {signup.notes && (
                    <span className="hidden max-w-[120px] truncate text-xs text-muted-foreground sm:inline">
                      {signup.notes}
                    </span>
                  )}
                  {typeof rating === 'number' && (
                    <span
                      className="flex items-center gap-0.5 font-mono text-xs tabular-nums text-muted-foreground"
                      title={ratingTitle}
                    >
                      <Star className="h-3 w-3 fill-primary text-primary" strokeWidth={1.75} aria-hidden="true" />
                      {rating.toFixed(1)}
                    </span>
                  )}
                  {position && <PositionChip position={position} />}

                  {canToggleNoShow && (
                    <button
                      type="button"
                      className={iconButtonClassName}
                      onClick={() => handleToggleNoShow(signup.id, signup.status)}
                      disabled={togglingId === signup.id}
                      aria-label={isNoShow ? t('ui.matchScreens.match.markPresent') : t('ui.matchScreens.match.markNoShow')}
                      title={isNoShow ? t('ui.matchScreens.match.markPresent') : t('ui.matchScreens.match.markNoShow')}
                    >
                      {togglingId === signup.id ? (
                        <Spinner size="sm" />
                      ) : isNoShow ? (
                        <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
                      ) : (
                        <UserX className="h-4 w-4" strokeWidth={1.75} />
                      )}
                    </button>
                  )}

                  {isAdminOrCaptain && !isNoShow && (
                    <button
                      type="button"
                      className={cn(iconButtonClassName, 'hover:text-destructive')}
                      onClick={() => handleRemove(signup.id, displayName)}
                      disabled={removingId === signup.id}
                      aria-label={t('ui.matchScreens.match.removeFromMatch')}
                      title={t('ui.matchScreens.match.removeFromMatch')}
                    >
                      {removingId === signup.id ? <Spinner size="sm" /> : <X className="h-4 w-4" strokeWidth={1.75} />}
                    </button>
                  )}
                </>
              }
            />
          </li>
        )
      })}
    </ol>
  )
}
