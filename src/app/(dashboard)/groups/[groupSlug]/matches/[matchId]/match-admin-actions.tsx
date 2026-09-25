'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Play, Pause, RotateCcw, Users, CheckCircle, XCircle, Trash2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
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
  secondaryOnly = false,
  onNavigate,
}: MatchAdminActionsProps) {
  const router = useRouter()
  const supabase = createClient()
  const t = useT()
  const [loading, setLoading] = useState<string | null>(null)

  const updateStatus = async (newStatus: MatchStatus) => {
    setLoading(newStatus)

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
      alert('Error al actualizar el estado')
    } finally {
      setLoading(null)
    }
  }

  const handleDelete = async () => {
    if (!confirm('¿Estás seguro de eliminar este partido? Esta acción no se puede deshacer.')) {
      return
    }

    setLoading('delete')

    try {
      const { error } = await (supabase as any)
        .from('matches')
        .delete()
        .eq('id', matchId)

      if (error) throw error
      router.push(`/groups/${groupSlug}`)
      router.refresh()
    } catch (err) {
      console.error('Error deleting match:', err)
      alert('Error al eliminar el partido')
    } finally {
      setLoading(null)
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
      {!secondaryOnly && !hasTeams &&
        (currentStatus === 'signup_open' || currentStatus === 'full' || currentStatus === 'signup_closed') && (
          <p className="text-xs text-muted-foreground text-pretty">
            Sin equipos no se puede cerrar el partido: armá los equipos primero.
          </p>
        )}

      {/* Edit */}
      {canEdit && (
        <Button asChild variant="outline" className="w-full justify-start">
          <Link href={`/groups/${groupSlug}/matches/${matchId}/edit`} onClick={onNavigate}>
            <Pencil className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Editar partido
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
          Abrir inscripciones
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
          Cerrar inscripciones
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
          Reabrir inscripciones
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
          Marcar como finalizado
        </Button>
      )}

      {/* Cancel match */}
      {hasActions && currentStatus !== 'cancelled' && (
        <Button
          variant="outline"
          className="w-full justify-start text-destructive hover:text-destructive"
          onClick={() => { if (window.confirm(t('ui.workflow.cancelConfirm'))) void updateStatus('cancelled') }}
          disabled={loading !== null}
        >
          {loading === 'cancelled' ? (
            <Spinner size="sm" />
          ) : (
            <XCircle className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          )}
          Cancelar partido
        </Button>
      )}

      {/* Delete match */}
      {(currentStatus === 'draft' || currentStatus === 'cancelled') && (
        <Button
          variant="ghost"
          className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={handleDelete}
          disabled={loading !== null}
        >
          {loading === 'delete' ? (
            <Spinner size="sm" />
          ) : (
            <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          )}
          Eliminar partido
        </Button>
      )}
    </div>
  )
}
