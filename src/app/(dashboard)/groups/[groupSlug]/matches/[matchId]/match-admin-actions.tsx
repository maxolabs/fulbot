'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Play, Pause, RotateCcw, Users, CheckCircle, XCircle, Trash2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { FormNotice } from '@/components/form-controls'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/provider'
import type { Database } from '@/types/database'

type MatchStatus = Database['public']['Enums']['match_status']

interface MatchAdminActionsProps {
  matchId: string
  groupSlug: string
  currentStatus: string
  hasEnoughPlayers: boolean
  /** Teams exist for this match; without them the status can never reach 'finished'. */
  secondaryOnly?: boolean
  hasTeams?: boolean
  /** Deleting is admin-only (matches DELETE policy); captains don't get the button. */
  canDelete?: boolean
  /** Called after a navigation so the popover / sheet can close. */
  onNavigate?: () => void
}

// The content of the "Gestionar" popover (browser) and sheet (mobile),
// docs/ui-rework/04-components.md §4: no card of its own, every button and
// confirm dialog kept. Chalk outlines only; the one orange on the match
// screen belongs to the signup action.
export function MatchAdminActions({
  matchId,
  groupSlug,
  currentStatus,
  hasEnoughPlayers,
  hasTeams = true,
  canDelete = false,
  secondaryOnly = false,
  onNavigate,
}: MatchAdminActionsProps) {
  const router = useRouter()
  const supabase = createClient()
  const t = useT()
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Destructive action waiting for its inline confirmation. This content lives
  // inside a Popover / Sheet, so the confirm step stays inline instead of
  // opening another dialog on top.
  const [pendingConfirm, setPendingConfirm] = useState<'cancel' | 'delete' | null>(null)

  const updateStatus = async (newStatus: MatchStatus) => {
    setLoading(newStatus)
    setError(null)

    try {
      const args: Database['public']['Functions']['admin_set_match_status']['Args'] = {
        p_match_id: matchId,
        p_status: newStatus,
      }
      const { error } = await supabase.rpc('admin_set_match_status', args)

      if (error) throw error
      router.refresh()
    } catch (err) {
      console.error('Error updating status:', err)
      setError(t('ui.workflow.statusError'))
    } finally {
      setLoading(null)
    }
  }

  const handleDelete = async () => {
    setLoading('delete')
    setError(null)

    try {
      const { error } = await supabase
        .from('matches')
        .delete()
        .eq('id', matchId)

      if (error) throw error
      router.push(`/groups/${groupSlug}`)
      router.refresh()
    } catch (err) {
      console.error('Error deleting match:', err)
      setError(t('ui.lifecycle.deleteError'))
    } finally {
      setLoading(null)
      setPendingConfirm(null)
    }
  }

  const hasActions =
    currentStatus === 'draft' ||
    currentStatus === 'signup_open' ||
    currentStatus === 'full' ||
    currentStatus === 'signup_closed' ||
    currentStatus === 'teams_created' ||
    currentStatus === 'cancelled'

  const canEdit = currentStatus !== 'finished' && currentStatus !== 'cancelled'
  if (!hasActions && !canEdit) return null

  return (
    <div className="space-y-2">
      {error && <FormNotice kind="error">{error}</FormNotice>}
      {!secondaryOnly && !hasTeams &&
        (currentStatus === 'signup_open' || currentStatus === 'full' || currentStatus === 'signup_closed') && (
          <p className="text-xs text-muted-foreground text-pretty">
            {t('ui.adminActions.noTeamsHint')}
          </p>
        )}

      {/* Edit */}
      {canEdit && (
        <Button asChild variant="outline" className="w-full justify-start">
          <Link href={`/groups/${groupSlug}/matches/${matchId}/edit`} onClick={onNavigate}>
            <Pencil className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            {t('ui.adminActions.edit')}
          </Link>
        </Button>
      )}

      {/* Open signup */}
      {!secondaryOnly && currentStatus === 'draft' && (
        <Button
          variant="outline"
          className="w-full justify-start"
          onClick={() => updateStatus('signup_open')}
          disabled={loading !== null}
        >
          {loading === 'signup_open' ? (
            <Spinner size="sm" />
          ) : (
            <Play className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          )}
          {t('ui.workflow.open')}
        </Button>
      )}

      {/* Close signup */}
      {!secondaryOnly && (currentStatus === 'signup_open' || currentStatus === 'full') && (
        <Button
          variant="outline"
          className="w-full justify-start"
          onClick={() => updateStatus('signup_closed')}
          disabled={loading !== null}
        >
          {loading === 'signup_closed' ? (
            <Spinner size="sm" />
          ) : (
            <Pause className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          )}
          {t('ui.workflow.close')}
        </Button>
      )}

      {/* Reopen signup */}
      {!secondaryOnly && currentStatus === 'signup_closed' && (
        <Button
          variant="outline"
          className="w-full justify-start"
          onClick={() => updateStatus('signup_open')}
          disabled={loading !== null}
        >
          {loading === 'signup_open' ? (
            <Spinner size="sm" />
          ) : (
            <RotateCcw className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          )}
          {t('ui.workflow.reopen')}
        </Button>
      )}

      {/* Generate teams — or, once they exist, go and edit them */}
      {!secondaryOnly && (hasTeams ? (
        currentStatus !== 'cancelled' && (
          <Button asChild variant="outline" className="w-full justify-start">
            <Link href={`/groups/${groupSlug}/matches/${matchId}/teams`} onClick={onNavigate}>
              <Users className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              {t('ui.matchScreens.match.editTeams')}
            </Link>
          </Button>
        )
      ) : (
        (currentStatus === 'signup_open' || currentStatus === 'full' || currentStatus === 'signup_closed') && hasEnoughPlayers && (
          <Button asChild variant="outline" className="w-full justify-start">
            <Link href={`/groups/${groupSlug}/matches/${matchId}/teams`} onClick={onNavigate}>
              <Users className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              {t('ui.matchScreens.dashboard.buildTeams')}
            </Link>
          </Button>
        )
      ))}

      {/* Mark as finished */}
      {!secondaryOnly && currentStatus === 'teams_created' && (
        <Button
          variant="outline"
          className="w-full justify-start"
          onClick={() => updateStatus('finished')}
          disabled={loading !== null}
        >
          {loading === 'finished' ? (
            <Spinner size="sm" />
          ) : (
            <CheckCircle className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          )}
          {t('ui.adminActions.markFinished')}
        </Button>
      )}

      {/* Cancel match */}
      {hasActions && currentStatus !== 'cancelled' && pendingConfirm !== 'cancel' && (
        <Button
          variant="outline"
          className="w-full justify-start text-destructive hover:text-destructive"
          onClick={() => setPendingConfirm('cancel')}
          disabled={loading !== null}
        >
          <XCircle className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          {t('ui.adminActions.cancel')}
        </Button>
      )}

      {/* Delete match */}
      {canDelete && (currentStatus === 'draft' || currentStatus === 'cancelled') && pendingConfirm !== 'delete' && (
        <Button
          variant="ghost"
          className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setPendingConfirm('delete')}
          disabled={loading !== null}
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          {t('ui.adminActions.delete')}
        </Button>
      )}

      {pendingConfirm && (
        <div className="space-y-3 rounded-md border border-destructive p-3">
          <p className="text-sm text-pretty">
            {t(pendingConfirm === 'cancel' ? 'ui.workflow.cancelConfirm' : 'ui.adminActions.deleteConfirm')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={loading !== null}
              onClick={async () => {
                if (pendingConfirm === 'delete') {
                  await handleDelete()
                } else {
                  await updateStatus('cancelled')
                  setPendingConfirm(null)
                }
              }}
            >
              {(loading === 'cancelled' || loading === 'delete') && <Spinner size="sm" />}
              {t(pendingConfirm === 'cancel' ? 'ui.adminActions.confirmCancel' : 'ui.adminActions.confirmDelete')}
            </Button>
            <Button variant="outline" size="sm" disabled={loading !== null} onClick={() => setPendingConfirm(null)}>
              {t('common.back')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
