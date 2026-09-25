'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { FormNotice } from '@/components/form-controls'
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
  const [error, setError] = useState<string | null>(null)
  // No-show toggle waiting for confirmation (same Sheet pattern as finishing the match).
  const [pendingToggle, setPendingToggle] = useState<{ id: string; status: string; name: string } | null>(null)
  // Signup waiting for the removal confirmation (same Sheet pattern).
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; name: string } | null>(null)

  const canToggleNoShow = isAdminOrCaptain && matchStatus === 'finished'

  const handleRemove = async (signupId: string, displayName: string) => {
    setRemovingId(signupId)
    setError(null)

    try {
      const args: Database['public']['Functions']['admin_remove_signup']['Args'] = {
        p_signup_id: signupId,
      }
      const { error } = await supabase.rpc('admin_remove_signup', args)

      if (error) throw error

      router.refresh()
    } catch (err) {
      console.error('Error removing signup:', err)
      setError(t('ui.postMatch.removeError', { name: displayName }))
    } finally {
      setPendingRemoval(null)
      setRemovingId(null)
    }
  }

  const handleToggleNoShow = async (signupId: string, currentStatus: string) => {
    setTogglingId(signupId)
    setError(null)

    try {
      const newStatus: Database['public']['Enums']['signup_status'] =
        currentStatus === 'did_not_show' ? 'confirmed' : 'did_not_show'
      const args: Database['public']['Functions']['admin_set_signup_status']['Args'] = {
        p_signup_id: signupId,
        p_status: newStatus,
      }
      const { error } = await supabase.rpc('admin_set_signup_status', args)

      if (error) throw error

      setPendingToggle(null)
      router.refresh()
    } catch (err) {
      console.error('Error updating attendance:', err)
      setPendingToggle(null)
      setError(t('ui.postMatch.attendanceError'))
    } finally {
      setTogglingId(null)
    }
  }

  if (signups.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">{emptyMessage}</p>
  }

  const pendingIsNoShow = pendingToggle?.status === 'did_not_show'

  return (
    <>
      {error && <FormNotice kind="error" className="mb-2">{error}</FormNotice>}
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
                        className="hidden items-center gap-0.5 font-mono text-xs tabular-nums text-muted-foreground sm:flex"
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
                        onClick={() => setPendingToggle({ id: signup.id, status: signup.status, name: displayName })}
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
                        onClick={() => setPendingRemoval({ id: signup.id, name: displayName })}
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
      {canToggleNoShow && (
        <Sheet
          open={pendingToggle !== null}
          onOpenChange={(open) => { if (!open) setPendingToggle(null) }}
          title={pendingToggle
            ? t(pendingIsNoShow ? 'ui.postMatch.presentConfirmTitle' : 'ui.postMatch.noShowConfirmTitle', { name: pendingToggle.name })
            : ''}
          description={t(pendingIsNoShow ? 'ui.postMatch.presentConfirmBody' : 'ui.postMatch.noShowConfirmBody')}
        >
          <div className="flex flex-wrap gap-3 pt-4">
            <Button
              disabled={togglingId !== null}
              onClick={() => pendingToggle && handleToggleNoShow(pendingToggle.id, pendingToggle.status)}
            >
              {togglingId !== null && <Spinner size="sm" />}
              {t(pendingIsNoShow ? 'ui.matchScreens.match.markPresent' : 'ui.matchScreens.match.markNoShow')}
            </Button>
            <Button variant="outline" disabled={togglingId !== null} onClick={() => setPendingToggle(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </Sheet>
      )}
      {isAdminOrCaptain && (
        <Sheet
          open={pendingRemoval !== null}
          onOpenChange={(open) => { if (!open && removingId === null) setPendingRemoval(null) }}
          title={pendingRemoval ? t('ui.postMatch.removeConfirmTitle', { name: pendingRemoval.name }) : ''}
        >
          <div className="flex flex-wrap gap-3 pt-4">
            <Button
              variant="destructive"
              disabled={removingId !== null}
              onClick={() => pendingRemoval && handleRemove(pendingRemoval.id, pendingRemoval.name)}
            >
              {removingId !== null && <Spinner size="sm" />}
              {t('ui.matchScreens.match.removeFromMatch')}
            </Button>
            <Button variant="outline" disabled={removingId !== null} onClick={() => setPendingRemoval(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </Sheet>
      )}
    </>
  )
}
