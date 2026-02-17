'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Play, Pause, Users, CheckCircle, XCircle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'

interface MatchAdminActionsProps {
  matchId: string
  groupSlug: string
  currentStatus: string
  hasEnoughPlayers: boolean
}

export function MatchAdminActions({
  matchId,
  groupSlug,
  currentStatus,
  hasEnoughPlayers,
}: MatchAdminActionsProps) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState<string | null>(null)

  const updateStatus = async (newStatus: string) => {
    setLoading(newStatus)

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('matches')
        .update({ status: newStatus })
        .eq('id', matchId)

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Administrar partido</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Open signup */}
        {currentStatus === 'draft' && (
          <Button
            variant="default"
            className="w-full justify-start"
            onClick={() => updateStatus('signup_open')}
            disabled={loading !== null}
          >
            {loading === 'signup_open' ? (
              <Spinner size="sm" className="mr-2" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Abrir inscripciones
          </Button>
        )}

        {/* Close signup */}
        {currentStatus === 'signup_open' && (
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => updateStatus('draft')}
            disabled={loading !== null}
          >
            {loading === 'draft' ? (
              <Spinner size="sm" className="mr-2" />
            ) : (
              <Pause className="mr-2 h-4 w-4" />
            )}
            Cerrar inscripciones
          </Button>
        )}

        {/* Generate teams */}
        {(currentStatus === 'signup_open' || currentStatus === 'full') && hasEnoughPlayers && (
          <Link href={`/groups/${groupSlug}/matches/${matchId}/teams`}>
            <Button variant="default" className="w-full justify-start">
              <Users className="mr-2 h-4 w-4" />
              Armar equipos
            </Button>
          </Link>
        )}

        {/* Mark as finished */}
        {currentStatus === 'teams_created' && (
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => updateStatus('finished')}
            disabled={loading !== null}
          >
            {loading === 'finished' ? (
              <Spinner size="sm" className="mr-2" />
            ) : (
              <CheckCircle className="mr-2 h-4 w-4" />
            )}
            Marcar como finalizado
          </Button>
        )}

        {/* Cancel match */}
        {currentStatus !== 'finished' && currentStatus !== 'cancelled' && (
          <Button
            variant="outline"
            className="w-full justify-start text-destructive hover:text-destructive"
            onClick={() => updateStatus('cancelled')}
            disabled={loading !== null}
          >
            {loading === 'cancelled' ? (
              <Spinner size="sm" className="mr-2" />
            ) : (
              <XCircle className="mr-2 h-4 w-4" />
            )}
            Cancelar partido
          </Button>
        )}

        {/* Delete match */}
        {(currentStatus === 'draft' || currentStatus === 'cancelled') && (
          <Button
            variant="ghost"
            className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleDelete}
            disabled={loading !== null}
          >
            {loading === 'delete' ? (
              <Spinner size="sm" className="mr-2" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Eliminar partido
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
