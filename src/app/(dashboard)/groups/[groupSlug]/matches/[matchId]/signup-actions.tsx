'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, XCircle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'

interface SignupActionsProps {
  matchId: string
  currentSignup: {
    id: string
    status: string
    waitlistPosition: number | null
  } | null
  matchStatus: string
  isFull: boolean
}

export function SignupActions({
  matchId,
  currentSignup,
  matchStatus,
  isFull,
}: SignupActionsProps) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSignUp = matchStatus === 'signup_open' || matchStatus === 'full'

  const handleSignUp = async () => {
    setLoading(true)
    setError(null)

    try {
      const args: Database['public']['Functions']['signup_for_match']['Args'] = {
        p_match_id: matchId,
      }
      const { error: signupError } = await (supabase as any).rpc('signup_for_match', args)

      if (signupError) {
        throw signupError
      }

      router.refresh()
    } catch (err) {
      console.error('Error signing up:', err)
      setError('Error al inscribirse. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!confirm('¿Estás seguro de que querés bajarte del partido?')) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const args: Database['public']['Functions']['cancel_my_signup']['Args'] = {
        p_match_id: matchId,
      }
      const { error: cancelError } = await (supabase as any).rpc('cancel_my_signup', args)

      if (cancelError) {
        throw cancelError
      }

      router.refresh()
    } catch (err) {
      console.error('Error canceling signup:', err)
      setError('Error al bajarse. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  // Not signed up
  if (!currentSignup) {
    return (
      <Card>
        <CardContent className="py-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">
                {matchStatus === 'signup_closed'
                  ? 'Las inscripciones están cerradas'
                  : isFull
                    ? 'El partido está completo'
                    : 'Inscribite al partido'}
              </p>
              <p className="text-sm text-muted-foreground">
                {matchStatus === 'signup_closed'
                  ? 'El admin todavía no las volvió a abrir'
                  : isFull
                    ? 'Podés anotarte en la lista de espera'
                    : 'Hay lugar disponible'}
              </p>
            </div>
            <Button onClick={handleSignUp} disabled={loading || !canSignUp}>
              {loading && <Spinner size="sm" className="mr-2" />}
              {isFull ? 'Anotarme en espera' : 'Inscribirme'}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Confirmed
  if (currentSignup.status === 'confirmed') {
    return (
      <Card className="border-green-500/30 bg-green-500/5">
        <CardContent className="py-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <p className="font-medium text-green-700">Estás inscripto</p>
                <p className="text-sm text-muted-foreground">
                  Tenés tu lugar confirmado
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={handleCancel} disabled={loading}>
              {loading && <Spinner size="sm" className="mr-2" />}
              Bajarme
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Waitlist
  if (currentSignup.status === 'waitlist') {
    return (
      <Card className="border-yellow-500/30 bg-yellow-500/5">
        <CardContent className="py-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-yellow-600" />
              <div>
                <p className="font-medium text-yellow-700">
                  Estás en la lista de espera
                </p>
                <p className="text-sm text-muted-foreground">
                  Posición #{currentSignup.waitlistPosition} - Te avisaremos si se libera un lugar
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={handleCancel} disabled={loading}>
              {loading && <Spinner size="sm" className="mr-2" />}
              Salir de espera
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return null
}
