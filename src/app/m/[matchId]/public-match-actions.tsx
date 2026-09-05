'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'

interface MemberSignup {
  id: string
  status: 'confirmed' | 'waitlist'
  waitlistPosition: number | null
}

interface GuestSignup {
  status: 'confirmed' | 'waitlist'
  waitlistPosition: number | null
}

interface PublicMatchActionsProps {
  matchId: string
  groupSlug: string
  status: 'signup_open' | 'full' | 'signup_closed'
  isPast: boolean
  isLoggedIn: boolean
  isMember: boolean
  memberSignup: MemberSignup | null
  guestSignup: GuestSignup | null
  inviteCode: string | null
}

function ErrorBanner({ error }: { error: string }) {
  return (
    <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {error}
    </div>
  )
}

export function PublicMatchActions({
  matchId,
  groupSlug,
  status,
  isPast,
  isLoggedIn,
  isMember,
  memberSignup,
  guestSignup,
  inviteCode,
}: PublicMatchActionsProps) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guestName, setGuestName] = useState('')

  const isClosed = status === 'signup_closed'
  const isFull = status === 'full'

  if (isPast) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        Este partido ya pasó
      </p>
    )
  }

  // Case 3: logged-in member -- sign up / cancel through the member RPCs
  if (isLoggedIn && isMember) {
    const handleSignUp = async () => {
      setLoading(true)
      setError(null)
      try {
        const args: Database['public']['Functions']['signup_for_match']['Args'] = {
          p_match_id: matchId,
        }
        const { error: rpcError } = await supabase.rpc('signup_for_match', args)
        if (rpcError) throw rpcError
        router.refresh()
      } catch (err) {
        console.error('Error signing up:', err)
        setError('Error al inscribirte')
      } finally {
        setLoading(false)
      }
    }

    const handleCancel = async () => {
      if (!confirm('¿Estás seguro de que querés bajarte del partido?')) return
      setLoading(true)
      setError(null)
      try {
        const args: Database['public']['Functions']['cancel_my_signup']['Args'] = {
          p_match_id: matchId,
        }
        const { error: rpcError } = await supabase.rpc('cancel_my_signup', args)
        if (rpcError) throw rpcError
        router.refresh()
      } catch (err) {
        console.error('Error canceling signup:', err)
        setError('Error al bajarte')
      } finally {
        setLoading(false)
      }
    }

    if (memberSignup?.status === 'confirmed') {
      return (
        <div className="space-y-3">
          {error && <ErrorBanner error={error} />}
          <div className="flex items-center justify-center gap-2 text-green-600">
            <CheckCircle className="h-5 w-5" />
            <span className="font-medium">Estás inscripto</span>
          </div>
          <div className="flex gap-2">
            <Link href={`/groups/${groupSlug}/matches/${matchId}`} className="flex-1">
              <Button variant="outline" className="w-full">Ver partido</Button>
            </Link>
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

    if (memberSignup?.status === 'waitlist') {
      return (
        <div className="space-y-3">
          {error && <ErrorBanner error={error} />}
          <div className="flex items-center justify-center gap-2 text-yellow-600">
            <Clock className="h-5 w-5" />
            <span className="font-medium">
              En lista de espera (#{memberSignup.waitlistPosition})
            </span>
          </div>
          <div className="flex gap-2">
            <Link href={`/groups/${groupSlug}/matches/${matchId}`} className="flex-1">
              <Button variant="outline" className="w-full">Ver partido</Button>
            </Link>
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

    if (isClosed) {
      return (
        <p className="text-center text-sm text-muted-foreground">
          Las inscripciones están cerradas
        </p>
      )
    }

    return (
      <div className="space-y-3">
        {error && <ErrorBanner error={error} />}
        <Button className="w-full" onClick={handleSignUp} disabled={loading}>
          {loading && <Spinner size="sm" className="mr-2" />}
          {isFull ? 'Anotarme en lista de espera' : 'Inscribirme'}
        </Button>
      </div>
    )
  }

  // Case 4: logged-in, not a member yet -- join then sign up in one step
  if (isLoggedIn && !isMember) {
    const handleJoinAndSignUp = async () => {
      if (!inviteCode) {
        setError('No se pudo unir al grupo')
        return
      }
      setLoading(true)
      setError(null)
      try {
        const joinArgs: Database['public']['Functions']['join_group_via_invite']['Args'] = {
          p_invite_code: inviteCode,
        }
        const { error: joinError } = await supabase.rpc('join_group_via_invite', joinArgs)
        if (joinError) throw joinError

        const signupArgs: Database['public']['Functions']['signup_for_match']['Args'] = {
          p_match_id: matchId,
        }
        const { error: signupError } = await supabase.rpc('signup_for_match', signupArgs)
        if (signupError) throw signupError

        router.refresh()
      } catch (err) {
        console.error('Error joining and signing up:', err)
        setError('Error al unirte e inscribirte')
      } finally {
        setLoading(false)
      }
    }

    return (
      <div className="space-y-3">
        {error && <ErrorBanner error={error} />}
        <Button
          className="w-full"
          onClick={handleJoinAndSignUp}
          disabled={loading || isClosed}
        >
          {loading && <Spinner size="sm" className="mr-2" />}
          Unirme al grupo e inscribirme
        </Button>
        {isClosed && (
          <p className="text-center text-xs text-muted-foreground">
            Las inscripciones están cerradas
          </p>
        )}
      </div>
    )
  }

  // Case 2: a guest cookie ties this visitor to an active signup
  if (guestSignup) {
    const handleCancelGuest = async () => {
      if (!confirm('¿Estás seguro de que querés bajarte del partido?')) return
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/matches/${matchId}/guest-signup`, {
          method: 'DELETE',
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Error al bajarte')
        router.refresh()
      } catch (err) {
        console.error('Error canceling guest signup:', err)
        setError(err instanceof Error ? err.message : 'Error al bajarte')
      } finally {
        setLoading(false)
      }
    }

    if (guestSignup.status === 'confirmed') {
      return (
        <div className="space-y-3">
          {error && <ErrorBanner error={error} />}
          <div className="flex items-center justify-center gap-2 text-green-600">
            <CheckCircle className="h-5 w-5" />
            <span className="font-medium">Estás anotado (invitado)</span>
          </div>
          <Button
            variant="ghost"
            className="w-full text-destructive hover:text-destructive"
            onClick={handleCancelGuest}
            disabled={loading}
          >
            {loading && <Spinner size="sm" className="mr-2" />}
            Bajarme
          </Button>
        </div>
      )
    }

    return (
      <div className="space-y-3">
        {error && <ErrorBanner error={error} />}
        <div className="flex items-center justify-center gap-2 text-yellow-600">
          <Clock className="h-5 w-5" />
          <span className="font-medium">
            En lista de espera (#{guestSignup.waitlistPosition}) - invitado
          </span>
        </div>
        <Button
          variant="ghost"
          className="w-full text-destructive hover:text-destructive"
          onClick={handleCancelGuest}
          disabled={loading}
        >
          {loading && <Spinner size="sm" className="mr-2" />}
          Salir
        </Button>
      </div>
    )
  }

  // Case 1: anonymous (or logged-in-but-unmatched) visitor with no active guest signup
  const handleGuestSignUp = async () => {
    if (!guestName.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/matches/${matchId}/guest-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: guestName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al anotarte')
      router.refresh()
    } catch (err) {
      console.error('Error signing up as guest:', err)
      setError(err instanceof Error ? err.message : 'Error al anotarte')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      {error && <ErrorBanner error={error} />}
      {isClosed ? (
        <p className="text-center text-sm text-muted-foreground">
          Las inscripciones están cerradas
        </p>
      ) : (
        <>
          <Input
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="Tu nombre"
            maxLength={60}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleGuestSignUp()
            }}
          />
          <Button
            className="w-full"
            onClick={handleGuestSignUp}
            disabled={loading || !guestName.trim()}
          >
            {loading && <Spinner size="sm" className="mr-2" />}
            {isFull ? 'Anotarme en lista de espera' : 'Anotarme'}
          </Button>
        </>
      )}
      {!isLoggedIn && (
        <p className="text-center text-sm text-muted-foreground">
          ¿Tenés cuenta?{' '}
          <Link
            href={`/login?redirect=/m/${matchId}`}
            className="text-primary underline underline-offset-4"
          >
            Iniciá sesión
          </Link>
        </p>
      )}
    </div>
  )
}
