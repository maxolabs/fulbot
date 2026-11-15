'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Database, WaitlistReason } from '@/types/database'
import { useT } from '@/i18n/provider'

// The current user's signup action as data (docs/ui-rework/04-components.md
// §4): one hook owns the two RPCs (signup_for_match / cancel_my_signup) and
// the pending / error state, so the inline block in the browser and the
// mobile ActionBar render the same thing without duplicating the logic.

export interface SignupInput {
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

export type SignupStatus = 'none' | 'closed' | 'confirmed' | 'waitlist'

export interface SignupButton {
  label: string
  onClick?: () => void
  disabled: boolean
  pending: boolean
  /** `done` = the state itself ("Estás anotado"), not an action; render it flat. */
  tone: 'action' | 'done'
}

export interface SignupAction {
  status: SignupStatus
  primary: SignupButton
  secondary?: SignupButton
  /** One-line explanation under the buttons (waitlist position, reason, closed…). */
  detail: string | null
  error: string | null
}

// The signup RPCs raise Spanish messages (00021, 00025, 00029). The ones a
// member can act on map to ui.matchLifecycle.errors.*; they all mean the page
// is stale, so the caller refreshes it. Anything else stays generic.
const SIGNUP_ERRORS: Array<[string, string]> = [
  ['El partido ya empezó', 'started'],
  ['no está aceptando inscripciones', 'closed'],
  ['Ya estás inscripto', 'alreadySignedUp'],
  ['No estás inscripto', 'notSignedUp'],
  ['ya no admite cambios', 'locked'],
]

export function signupErrorKey(err: unknown): string | null {
  const message = (err as { message?: unknown } | null)?.message
  if (typeof message !== 'string') return null
  const hit = SIGNUP_ERRORS.find(([needle]) => message.includes(needle))
  return hit ? `ui.matchLifecycle.errors.${hit[1]}` : null
}

// How long the armed "Confirmar salida" button waits for the second tap.
const CONFIRM_LEAVE_MS = 5000

export function useSignupAction({ matchId, currentSignup, matchStatus, isFull }: SignupInput): SignupAction {
  const router = useRouter()
  const supabase = createClient()
  const t = useT()
  const [loading, setLoading] = useState<'signup' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Reason returned by signup_for_match when the signup lands on the waitlist
  // (docs/member-scoring.md §10.4). Shown right away; after router.refresh()
  // the same value comes back through currentSignup.waitlistReason.
  const [signupReason, setSignupReason] = useState<WaitlistReason | null>(null)
  // Leaving is a two-tap inline confirm: the first tap arms the button, the
  // second one cancels the signup. It disarms itself after a few seconds.
  const [confirmingLeave, setConfirmingLeave] = useState(false)

  useEffect(() => {
    if (!confirmingLeave) return
    const timer = setTimeout(() => setConfirmingLeave(false), CONFIRM_LEAVE_MS)
    return () => clearTimeout(timer)
  }, [confirmingLeave])

  // A known RPC error means the page is out of date: say why and refresh it.
  const fail = useCallback((err: unknown, fallback: string) => {
    const key = signupErrorKey(err)
    setError(t(key ?? fallback))
    if (key) router.refresh()
  }, [router, t])

  const canSignUp = matchStatus === 'signup_open' || matchStatus === 'full'

  const signUp = useCallback(async () => {
    setLoading('signup')
    setError(null)
    try {
      const args: Database['public']['Functions']['signup_for_match']['Args'] = { p_match_id: matchId }
      const { data: signup, error: signupError } = await supabase.rpc('signup_for_match', args)
      if (signupError) throw signupError
      // waitlist_reason is a CHECK-constrained text column, so the generated type is plain string.
      setSignupReason(signup?.status === 'waitlist' ? (signup.waitlist_reason as WaitlistReason | null) ?? 'full' : null)
      router.refresh()
    } catch (err) {
      console.error('Error signing up:', err)
      fail(err, 'matches.signupError')
    } finally {
      setLoading(null)
    }
  }, [fail, matchId, router, supabase])

  const cancel = useCallback(async () => {
    if (!confirmingLeave) {
      setError(null)
      setConfirmingLeave(true)
      return
    }
    setConfirmingLeave(false)
    setLoading('cancel')
    setError(null)
    try {
      const args: Database['public']['Functions']['cancel_my_signup']['Args'] = { p_match_id: matchId }
      const { error: cancelError } = await supabase.rpc('cancel_my_signup', args)
      if (cancelError) throw cancelError
      router.refresh()
    } catch (err) {
      console.error('Error canceling signup:', err)
      fail(err, 'matches.cancelError')
    } finally {
      setLoading(null)
    }
  }, [confirmingLeave, fail, matchId, router, supabase])

  return useMemo<SignupAction>(() => {
    const busy = loading !== null

    if (currentSignup?.status === 'confirmed') {
      return {
        status: 'confirmed',
        primary: { label: t('ui.matchScreens.match.signedUp'), disabled: true, pending: false, tone: 'done' },
        secondary: { label: confirmingLeave ? t('ui.matchLifecycle.confirmLeave') : t('matches.leaveMatch'), onClick: cancel, disabled: busy, pending: loading === 'cancel', tone: 'action' },
        detail: confirmingLeave ? t('ui.matchLifecycle.confirmLeaveDetail') : t('matches.confirmedSpot'),
        error,
      }
    }

    if (currentSignup?.status === 'waitlist') {
      const reason = currentSignup.waitlistReason ?? signupReason
      const position = currentSignup.waitlistPosition ?? 0
      return {
        status: 'waitlist',
        primary: {
          label: t('ui.matchScreens.match.waitlistPosition', { position }),
          disabled: true,
          pending: false,
          tone: 'done',
        },
        secondary: { label: confirmingLeave ? t('ui.matchLifecycle.confirmLeave') : t('matches.leaveWaitlist'), onClick: cancel, disabled: busy, pending: loading === 'cancel', tone: 'action' },
        detail: confirmingLeave
          ? t('ui.matchLifecycle.confirmLeaveDetail')
          : reason ? t(`signupPolicy.waitlistReason.${reason}`) : t('matches.waitlistPositionDetail', { position }),
        error,
      }
    }

    if (!canSignUp) {
      return {
        status: 'closed',
        primary: { label: t('ui.matchScreens.match.signupClosed'), disabled: true, pending: false, tone: 'done' },
        detail: t('matches.signupClosedSubtitle'),
        error,
      }
    }

    return {
      status: 'none',
      primary: {
        label: isFull ? t('matches.joinWaitlist') : t('matches.signup'),
        onClick: signUp,
        disabled: busy,
        pending: loading === 'signup',
        tone: 'action',
      },
      detail: isFull ? t('matches.canJoinWaitlist') : t('matches.spotsAvailable'),
      error,
    }
  }, [cancel, canSignUp, confirmingLeave, currentSignup, error, isFull, loading, signUp, signupReason, t])
}
