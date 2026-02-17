'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'

interface PublicSignupButtonProps {
  matchId: string
  playerId: string
  groupSlug: string
  currentSignup: {
    id: string
    status: string
    waitlist_position: number | null
  } | null
  isFull: boolean
  isPast: boolean
}

export function PublicSignupButton({
  matchId,
  playerId,
  groupSlug,
  currentSignup,
  isFull,
  isPast,
}: PublicSignupButtonProps) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSignUp = async () => {
    setLoading(true)
    setError(null)

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: signupError } = await (supabase as any).rpc('process_match_signup', {
        p_match_id: matchId,
        p_player_id: playerId,
      })

      if (signupError) {
        throw signupError
      }

      router.refresh()
    } catch (err) {
      console.error('Error signing up:', err)
      setError('Error al inscribirse')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!confirm('¿Estás seguro de que querés bajarte?')) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: cancelError } = await (supabase as any).rpc('cancel_match_signup', {
        p_match_id: matchId,
        p_player_id: playerId,
      })

      if (cancelError) {
        throw cancelError
      }

      router.refresh()
    } catch (err) {
      console.error('Error canceling:', err)
      setError('Error al bajarse')
    } finally {
      setLoading(false)
    }
  }

  if (isPast) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        Este partido ya pasó
      </p>
    )
  }

  if (currentSignup?.status === 'confirmed') {
    return (
      <div className="space-y-3">
        {error && (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="flex items-center justify-center gap-2 text-green-600">
          <CheckCircle className="h-5 w-5" />
          <span className="font-medium">Estás inscripto</span>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => router.push(`/groups/${groupSlug}/matches/${matchId}`)}
          >
            Ver partido
          </Button>
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={handleCancel}
            disabled={loading}
          >
            {loading && <Spinner size="sm" className="mr-2" />}
            Bajarme
          </Button>
        </div>
      </div>
    )
  }

  if (currentSignup?.status === 'waitlist') {
    return (
      <div className="space-y-3">
        {error && (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="flex items-center justify-center gap-2 text-yellow-600">
          <Clock className="h-5 w-5" />
          <span className="font-medium">
            En lista de espera (#{currentSignup.waitlist_position})
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => router.push(`/groups/${groupSlug}/matches/${matchId}`)}
          >
            Ver partido
          </Button>
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={handleCancel}
            disabled={loading}
          >
            {loading && <Spinner size="sm" className="mr-2" />}
            Salir
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <Button
        className="w-full"
        onClick={handleSignUp}
        disabled={loading}
      >
        {loading && <Spinner size="sm" className="mr-2" />}
        {isFull ? 'Anotarme en lista de espera' : 'Inscribirme'}
      </Button>
    </div>
  )
}
