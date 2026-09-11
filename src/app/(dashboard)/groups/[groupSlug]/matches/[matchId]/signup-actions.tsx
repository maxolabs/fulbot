'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, XCircle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import type { Database, WaitlistReason } from '@/types/database'
import { useT } from '@/i18n/provider'

interface SignupActionsProps {
  matchId: string
  currentSignup: {
    id: string
    status: string
    waitlistPosition: number | null
    waitlistReason?: WaitlistReason | null
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
  const t = useT()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Reason returned by signup_for_match when the signup lands on the waitlist
  // (docs/member-scoring.md §10.4). Shown right away; after router.refresh()
  // the same value comes back through currentSignup.waitlistReason.
  const [signupReason, setSignupReason] = useState<WaitlistReason | null>(null)

  const canSignUp = matchStatus === 'signup_open' || matchStatus === 'full'

  const handleSignUp = async () => {
    setLoading(true)
    setError(null)

    try {
      const args: Database['public']['Functions']['signup_for_match']['Args'] = {
        p_match_id: matchId,
      }
      const { data: signup, error: signupError } = await supabase.rpc('signup_for_match', args)

      if (signupError) {
        throw signupError
      }

      setSignupReason(signup?.status === 'waitlist' ? signup.waitlist_reason ?? 'full' : null)
      router.refresh()
    } catch (err) {
      console.error('Error signing up:', err)
      setError(t('matches.signupError'))
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!confirm(t('matches.confirmCancelSignup'))) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const args: Database['public']['Functions']['cancel_my_signup']['Args'] = {
        p_match_id: matchId,
      }
      const { error: cancelError } = await supabase.rpc('cancel_my_signup', args)

      if (cancelError) {
        throw cancelError
      }

      router.refresh()
    } catch (err) {
      console.error('Error canceling signup:', err)
      setError(t('matches.cancelError'))
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
                  ? t('matches.signupClosedTitle')
                  : isFull
                    ? t('matches.matchFull')
                    : t('matches.signupPrompt')}
              </p>
              <p className="text-sm text-muted-foreground">
                {matchStatus === 'signup_closed'
                  ? t('matches.signupClosedSubtitle')
                  : isFull
                    ? t('matches.canJoinWaitlist')
                    : t('matches.spotsAvailable')}
              </p>
            </div>
            <Button onClick={handleSignUp} disabled={loading || !canSignUp}>
              {loading && <Spinner size="sm" className="mr-2" />}
              {isFull ? t('matches.joinWaitlist') : t('matches.signup')}
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
                <p className="font-medium text-green-700">{t('matches.signedUp')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('matches.confirmedSpot')}
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={handleCancel} disabled={loading}>
              {loading && <Spinner size="sm" className="mr-2" />}
              {t('matches.leaveMatch')}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Waitlist
  if (currentSignup.status === 'waitlist') {
    const waitlistReason = currentSignup.waitlistReason ?? signupReason
    return (
      <Card className="border-yellow-500/30 bg-yellow-500/5">
        <CardContent className="py-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
              {error}
            </div>
          )}

          {/* Stacks on phones: the reason line below makes the text column too narrow for a side-by-side button */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 mt-0.5 shrink-0 text-yellow-600" />
              <div>
                <p className="font-medium text-yellow-700">
                  {t('matches.onWaitlist')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('matches.waitlistPositionDetail', { position: currentSignup.waitlistPosition ?? 0 })}
                </p>
                {waitlistReason && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {t(`signupPolicy.waitlistReason.${waitlistReason}`)}
                  </p>
                )}
              </div>
            </div>
            <Button variant="outline" onClick={handleCancel} disabled={loading} className="self-start sm:self-auto">
              {loading && <Spinner size="sm" className="mr-2" />}
              {t('matches.leaveWaitlist')}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return null
}
