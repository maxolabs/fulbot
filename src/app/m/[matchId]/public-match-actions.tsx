'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, Clock } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { ActionBar } from '@/components/layout/action-bar'
import { FormNotice } from '@/components/form-controls'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/provider'
import { cn } from '@/lib/utils/cn'
import type { Database } from '@/types/database'

// The visitor's signup state on /m/[matchId] (docs/ui-rework/03-screens.md
// §12). One component owns every RPC and renders two things from the same
// handlers: the inline state (status notice, guest name form, sign-in link)
// above `children` (the rosters), and the public ActionBar after them. The
// guest form is submitted from the action bar through the `form` attribute.

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
  children?: ReactNode
}

const GUEST_FORM_ID = 'guest-signup-form'

function StatusLine({ kind, children }: { kind: 'confirmed' | 'waitlist'; children: ReactNode }) {
  const Icon = kind === 'confirmed' ? CheckCircle : Clock
  return (
    <p role="status" className="flex items-center gap-2 text-sm font-medium">
      <Icon
        className={cn('h-4 w-4 shrink-0', kind === 'confirmed' ? 'text-success' : 'text-warning')}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      {children}
    </p>
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
  children,
}: PublicMatchActionsProps) {
  const t = useT()
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guestName, setGuestName] = useState('')

  const isClosed = status === 'signup_closed'
  const isFull = status === 'full'
  const matchHref = `/groups/${groupSlug}/matches/${matchId}`

  const viewMatchLink = (variant: 'primary' | 'outline') => (
    <Link
      href={matchHref}
      className={cn(buttonVariants({ size: 'xl', variant: variant === 'primary' ? 'default' : 'outline' }))}
    >
      {t('ui.screens.publicMatch.viewMatch')}
    </Link>
  )

  // --- handlers (one per RPC / route) -------------------------------------

  const handleSignUp = async () => {
    setLoading(true)
    setError(null)
    try {
      const args: Database['public']['Functions']['signup_for_match']['Args'] = { p_match_id: matchId }
      const { error: rpcError } = await supabase.rpc('signup_for_match', args)
      if (rpcError) throw rpcError
      router.refresh()
    } catch (err) {
      console.error('Error signing up:', err)
      setError(t('ui.screens.publicMatch.signupError'))
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!confirm(t('ui.screens.publicMatch.cancelConfirm'))) return
    setLoading(true)
    setError(null)
    try {
      const args: Database['public']['Functions']['cancel_my_signup']['Args'] = { p_match_id: matchId }
      const { error: rpcError } = await supabase.rpc('cancel_my_signup', args)
      if (rpcError) throw rpcError
      router.refresh()
    } catch (err) {
      console.error('Error canceling signup:', err)
      setError(t('ui.screens.publicMatch.cancelError'))
    } finally {
      setLoading(false)
    }
  }

  const handleJoinAndSignUp = async () => {
    if (!inviteCode) {
      setError(t('ui.screens.publicMatch.joinError'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      const joinArgs: Database['public']['Functions']['join_group_via_invite']['Args'] = { p_invite_code: inviteCode }
      const { error: joinError } = await supabase.rpc('join_group_via_invite', joinArgs)
      if (joinError) throw joinError

      const signupArgs: Database['public']['Functions']['signup_for_match']['Args'] = { p_match_id: matchId }
      const { error: signupError } = await supabase.rpc('signup_for_match', signupArgs)
      if (signupError) throw signupError

      router.refresh()
    } catch (err) {
      console.error('Error joining and signing up:', err)
      setError(t('ui.screens.publicMatch.joinSignupError'))
    } finally {
      setLoading(false)
    }
  }

  const handleCancelGuest = async () => {
    if (!confirm(t('ui.screens.publicMatch.cancelConfirm'))) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/matches/${matchId}/guest-signup`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || t('ui.screens.publicMatch.cancelError'))
      router.refresh()
    } catch (err) {
      console.error('Error canceling guest signup:', err)
      setError(err instanceof Error ? err.message : t('ui.screens.publicMatch.cancelError'))
    } finally {
      setLoading(false)
    }
  }

  const handleGuestSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
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
      if (!res.ok) throw new Error(data.error || t('ui.screens.publicMatch.guestError'))
      router.refresh()
    } catch (err) {
      console.error('Error signing up as guest:', err)
      setError(err instanceof Error ? err.message : t('ui.screens.publicMatch.guestError'))
    } finally {
      setLoading(false)
    }
  }

  // --- what to show, per case ----------------------------------------------

  let inline: ReactNode = null
  let bar: ReactNode = null

  if (isPast) {
    inline = <p className="text-sm text-muted-foreground">{t('ui.screens.publicMatch.past')}</p>
    if (isLoggedIn && isMember) bar = viewMatchLink('primary')
  } else if (isLoggedIn && isMember) {
    // Case 3: member -- sign up / cancel through the member RPCs
    if (memberSignup?.status === 'confirmed') {
      inline = <StatusLine kind="confirmed">{t('ui.screens.publicMatch.youAreIn')}</StatusLine>
      bar = (
        <>
          {viewMatchLink('primary')}
          <Button size="xl" variant="outline" onClick={handleCancel} disabled={loading}>
            {loading && <Spinner size="sm" />}
            {t('ui.screens.publicMatch.leave')}
          </Button>
        </>
      )
    } else if (memberSignup?.status === 'waitlist') {
      inline = (
        <StatusLine kind="waitlist">
          {t('ui.screens.publicMatch.youAreWaitlisted', { n: memberSignup.waitlistPosition ?? '' })}
        </StatusLine>
      )
      bar = (
        <>
          {viewMatchLink('primary')}
          <Button size="xl" variant="outline" onClick={handleCancel} disabled={loading}>
            {loading && <Spinner size="sm" />}
            {t('ui.screens.publicMatch.leaveWaitlist')}
          </Button>
        </>
      )
    } else if (isClosed) {
      inline = <p className="text-sm text-muted-foreground">{t('ui.screens.publicMatch.closed')}</p>
      bar = viewMatchLink('primary')
    } else {
      bar = (
        <>
          <Button size="xl" onClick={handleSignUp} disabled={loading}>
            {loading && <Spinner size="sm" />}
            {isFull ? t('ui.screens.publicMatch.fullJoinWaitlist') : t('ui.screens.publicMatch.signUp')}
          </Button>
          {viewMatchLink('outline')}
        </>
      )
    }
  } else if (isLoggedIn && !isMember) {
    // Case 4: signed in, not a member yet -- join then sign up in one step
    inline = isClosed ? <p className="text-sm text-muted-foreground">{t('ui.screens.publicMatch.closed')}</p> : null
    bar = (
      <Button size="xl" onClick={handleJoinAndSignUp} disabled={loading || isClosed}>
        {loading && <Spinner size="sm" />}
        {isFull ? t('ui.screens.publicMatch.fullJoinWaitlist') : t('ui.screens.publicMatch.joinAndSignUp')}
      </Button>
    )
  } else if (guestSignup) {
    // Case 2: a guest cookie ties this visitor to an active signup
    inline =
      guestSignup.status === 'confirmed' ? (
        <StatusLine kind="confirmed">{t('ui.screens.publicMatch.guestIn')}</StatusLine>
      ) : (
        <StatusLine kind="waitlist">
          {t('ui.screens.publicMatch.guestWaitlisted', { n: guestSignup.waitlistPosition ?? '' })}
        </StatusLine>
      )
    bar = (
      <Button size="xl" variant="outline" onClick={handleCancelGuest} disabled={loading}>
        {loading && <Spinner size="sm" />}
        {guestSignup.status === 'confirmed' ? t('ui.screens.publicMatch.leave') : t('ui.screens.publicMatch.leaveWaitlist')}
      </Button>
    )
  } else if (isClosed) {
    // Case 1, closed: nothing to do
    inline = <p className="text-sm text-muted-foreground">{t('ui.screens.publicMatch.closed')}</p>
  } else {
    // Case 1: anonymous visitor with no active guest signup -- the name form
    inline = (
      <form id={GUEST_FORM_ID} onSubmit={handleGuestSignUp} className="space-y-1.5">
        <Label htmlFor="guest-name">{t('ui.screens.publicMatch.yourName')}</Label>
        <Input
          id="guest-name"
          name="displayName"
          autoComplete="name"
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
          placeholder={t('ui.screens.publicMatch.namePlaceholder')}
          maxLength={60}
          required
          disabled={loading}
        />
        <p className="text-xs text-muted-foreground">{t('ui.screens.publicMatch.guestHint')}</p>
      </form>
    )
    bar = (
      <Button size="xl" type="submit" form={GUEST_FORM_ID} disabled={loading}>
        {loading && <Spinner size="sm" />}
        {isFull ? t('ui.screens.publicMatch.fullJoinWaitlist') : t('ui.screens.publicMatch.signUpAsGuest')}
      </Button>
    )
  }

  return (
    <>
      <div className="space-y-6 pb-28">
        {(inline || error) && (
          <div className="space-y-3">
            {error && <FormNotice kind="error">{error}</FormNotice>}
            {inline}
          </div>
        )}
        {children}
        {!isLoggedIn && (
          <p className="text-sm text-muted-foreground">
            {t('ui.screens.publicMatch.haveAccount')}{' '}
            <Link
              href={`/login?redirect=/m/${matchId}`}
              className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
            >
              {t('auth.loginCta')}
            </Link>
          </p>
        )}
      </div>
      {bar && (
        <ActionBar public className="mt-auto">
          {bar}
        </ActionBar>
      )}
    </>
  )
}
