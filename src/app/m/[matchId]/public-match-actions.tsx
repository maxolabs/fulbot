'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, Clock, Hourglass, Lock } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Sheet } from '@/components/ui/sheet'
import { ActionBar } from '@/components/layout/action-bar'
import { FormNotice } from '@/components/form-controls'
import { createClient } from '@/lib/supabase/client'
import { useLanguage, useT } from '@/i18n/provider'
import { cn } from '@/lib/utils/cn'
import { formatMatchDateShort, formatMatchTime } from '@/lib/utils/datetime'
import type { Database, GuestPriorityHold, WaitlistReason } from '@/types/database'
import { signupErrorKey } from '@/app/(dashboard)/groups/[groupSlug]/matches/[matchId]/use-signup-action'

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
  waitlistReason?: WaitlistReason | null
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
  /** The group's member priority period, for guests (00034, OD-8); null when none runs. */
  guestHold?: GuestPriorityHold | null
  /** The group's time zone, for the end of the priority period. */
  timeZone: string
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

// Guests come after the members while the priority policy runs (OD-8). Same
// look as SignupPolicyNoticeView, guest wording.
function GuestPriorityNotice({ reason, title, body }: { reason: 'priority_window' | 'reserved'; title: string; body: string }) {
  const Icon = reason === 'reserved' ? Lock : Hourglass
  return (
    <div role="status" className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-warning" strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground text-pretty">{title}</p>
        <p className="text-sm text-muted-foreground text-pretty">{body}</p>
      </div>
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
  guestHold = null,
  timeZone,
  inviteCode,
  children,
}: PublicMatchActionsProps) {
  const t = useT()
  const language = useLanguage()
  // When the members' priority ends, in the group's wall clock.
  const holdWhen = guestHold
    ? { date: formatMatchDateShort(guestHold.until, timeZone, language), time: formatMatchTime(guestHold.until, timeZone) }
    : null
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guestName, setGuestName] = useState('')
  // Leaving goes through a confirmation Sheet (member or guest signup).
  const [leaveTarget, setLeaveTarget] = useState<'member' | 'guest' | null>(null)

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

  // Known RPC errors (started, closed, already in, not in, locked) mean the
  // page is stale: show the translated reason and refresh it.
  const fail = (err: unknown, fallbackKey: string) => {
    const key = signupErrorKey(err)
    setError(t(key ?? fallbackKey))
    if (key) router.refresh()
  }

  // The guest route already answers with a translated message; a 400 is a
  // state problem (closed, started, gone), so the page is refreshed too.
  const failRoute = (message: string | undefined, status: number, fallbackKey: string) => {
    setError(message || t(fallbackKey))
    if (status === 400) router.refresh()
  }

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
      fail(err, 'ui.screens.publicMatch.signupError')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    setLoading(true)
    setError(null)
    try {
      const args: Database['public']['Functions']['cancel_my_signup']['Args'] = { p_match_id: matchId }
      const { error: rpcError } = await supabase.rpc('cancel_my_signup', args)
      if (rpcError) throw rpcError
      router.refresh()
    } catch (err) {
      console.error('Error canceling signup:', err)
      fail(err, 'ui.screens.publicMatch.cancelError')
    } finally {
      setLoading(false)
      setLeaveTarget(null)
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
      fail(err, 'ui.screens.publicMatch.joinSignupError')
    } finally {
      setLoading(false)
    }
  }

  const handleCancelGuest = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/matches/${matchId}/guest-signup`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        failRoute(data.error, res.status, 'ui.screens.publicMatch.cancelError')
        return
      }
      router.refresh()
    } catch (err) {
      console.error('Error canceling guest signup:', err)
      setError(t('ui.screens.publicMatch.cancelError'))
    } finally {
      setLoading(false)
      setLeaveTarget(null)
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
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        failRoute(data.error, res.status, 'ui.screens.publicMatch.guestError')
        return
      }
      router.refresh()
    } catch (err) {
      console.error('Error signing up as guest:', err)
      setError(t('ui.screens.publicMatch.guestError'))
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
          <Button size="xl" variant="outline" onClick={() => setLeaveTarget('member')} disabled={loading}>
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
          <Button size="xl" variant="outline" onClick={() => setLeaveTarget('member')} disabled={loading}>
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
    const heldReason =
      guestSignup.status === 'waitlist' &&
      (guestSignup.waitlistReason === 'priority_window' || guestSignup.waitlistReason === 'reserved')
        ? guestSignup.waitlistReason
        : null
    inline =
      guestSignup.status === 'confirmed' ? (
        <StatusLine kind="confirmed">{t('ui.screens.publicMatch.guestIn')}</StatusLine>
      ) : (
        <div className="space-y-1.5">
          <StatusLine kind="waitlist">
            {t('ui.screens.publicMatch.guestWaitlisted', { n: guestSignup.waitlistPosition ?? '' })}
          </StatusLine>
          {/* Waiting for the members' priority to end (OD-8), not for a free spot. */}
          {heldReason && holdWhen && (
            <p className="pl-6 text-sm text-muted-foreground text-pretty">
              {t(
                heldReason === 'reserved'
                  ? 'ui.lifecycle.guestPriority.waitlistedReserved'
                  : 'ui.lifecycle.guestPriority.waitlistedWindow',
                holdWhen
              )}
            </p>
          )}
        </div>
      )
    bar = (
      <Button size="xl" variant="outline" onClick={() => setLeaveTarget('guest')} disabled={loading}>
        {loading && <Spinner size="sm" />}
        {guestSignup.status === 'confirmed' ? t('ui.screens.publicMatch.leave') : t('ui.screens.publicMatch.leaveWaitlist')}
      </Button>
    )
  } else if (isClosed) {
    // Case 1, closed: nothing to do
    inline = <p className="text-sm text-muted-foreground">{t('ui.screens.publicMatch.closed')}</p>
  } else {
    // Case 1: anonymous visitor with no active guest signup -- the name form.
    // While the members' priority holds, the guest is told before signing up
    // that they go to the waitlist (OD-8).
    const held = !isFull && guestHold?.holds && holdWhen ? guestHold.reason : null
    inline = (
      <div className="space-y-4">
        {held && holdWhen && (
          <GuestPriorityNotice
            reason={held}
            title={t(
              held === 'reserved' ? 'ui.lifecycle.guestPriority.reservedTitle' : 'ui.lifecycle.guestPriority.windowTitle',
              holdWhen
            )}
            body={t('ui.lifecycle.guestPriority.body')}
          />
        )}
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
      </div>
    )
    bar = (
      <Button size="xl" type="submit" form={GUEST_FORM_ID} disabled={loading}>
        {loading && <Spinner size="sm" />}
        {isFull
          ? t('ui.screens.publicMatch.fullJoinWaitlist')
          : held
            ? t('ui.lifecycle.guestPriority.joinWaitlist')
            : t('ui.screens.publicMatch.signUpAsGuest')}
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
      <Sheet
        open={leaveTarget !== null}
        onOpenChange={(open) => { if (!open && !loading) setLeaveTarget(null) }}
        title={t('ui.matchLifecycle.leaveTitle')}
        description={t('ui.matchLifecycle.leaveBody')}
      >
        <div className="flex flex-wrap gap-3 pt-4">
          <Button
            variant="destructive"
            disabled={loading}
            onClick={() => { void (leaveTarget === 'guest' ? handleCancelGuest() : handleCancel()) }}
          >
            {loading && <Spinner size="sm" />}
            {t('ui.matchLifecycle.confirmLeave')}
          </Button>
          <Button variant="outline" disabled={loading} onClick={() => setLeaveTarget(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Sheet>
    </>
  )
}
