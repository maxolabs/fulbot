'use client'

import * as React from 'react'
import Link from 'next/link'
import { Check, CircleAlert, Clock, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ActionBar } from '@/components/layout/action-bar'
import { useSignupAction, type SignupAction, type SignupButton, type SignupInput } from './use-signup-action'

// Signup UI for the match screen (docs/ui-rework/03-screens.md §3). One
// `SignupProvider` owns the hook; `SignupActions` renders the inline block
// (browser) and `MatchActionBar` the mobile action bar at the end of the
// page. Both read the same action, so there is one RPC path and one state.

const SignupContext = React.createContext<SignupAction | null>(null)

export function SignupProvider({ children, ...input }: SignupInput & { children: React.ReactNode }) {
  const action = useSignupAction(input)
  return <SignupContext.Provider value={action}>{children}</SignupContext.Provider>
}

function useSignup(): SignupAction | null {
  return React.useContext(SignupContext)
}

function ButtonContent({ button, icon }: { button: SignupButton; icon?: React.ReactNode }) {
  return (
    <>
      {button.pending ? <Spinner size="sm" /> : icon}
      {button.label}
    </>
  )
}

/** Inline block for the browser (`hidden lg:block`); the mobile action bar covers phones. */
export function SignupActions() {
  const action = useSignup()
  if (!action) return null
  const { primary, secondary, detail, error, status } = action

  const icon =
    status === 'confirmed' ? (
      <Check className="h-4 w-4 text-success" strokeWidth={2} aria-hidden="true" />
    ) : status === 'waitlist' ? (
      <Clock className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
    ) : undefined

  return (
    <div className="hidden lg:block">
      <div className="flex flex-wrap items-center gap-3">
        {primary.tone === 'done' ? (
          <p className="flex min-h-10 items-center gap-2 text-sm font-semibold" aria-live="polite">
            {icon}
            {primary.label}
          </p>
        ) : (
          <Button type="button" onClick={primary.onClick} disabled={primary.disabled}>
            <ButtonContent button={primary} />
          </Button>
        )}
        {secondary && (
          <Button type="button" variant="outline" onClick={secondary.onClick} disabled={secondary.disabled}>
            <ButtonContent button={secondary} />
          </Button>
        )}
        {detail && <span className="text-sm text-muted-foreground">{detail}</span>}
      </div>
      {error && (
        <p className="mt-2 flex items-start gap-2 text-sm text-destructive" role="alert">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  )
}

/** Mobile-only line under the meter: the state's explanation and any RPC error. */
export function SignupDetail() {
  const action = useSignup()
  if (!action) return null
  const { detail, error, status } = action
  if (!detail && !error) return null
  return (
    <div className="space-y-1 lg:hidden" aria-live="polite">
      {detail && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          {status === 'confirmed' && <Check className="h-4 w-4 text-success" strokeWidth={2} aria-hidden="true" />}
          {status === 'waitlist' && <Clock className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />}
          {detail}
        </p>
      )}
      {error && (
        <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  )
}

export interface MatchActionBarProps {
  /** Admin extra: "Armar equipos" as primary, the signup action as secondary. */
  buildTeamsHref?: string
  buildTeamsLabel?: string
  /** Finished match: "Reportar resultado" until the viewer has reported. */
  reportHref?: string
  reportLabel?: string
}

/** The mobile action bar, placed as the last element of the page content. */
export function MatchActionBar({ buildTeamsHref, buildTeamsLabel, reportHref, reportLabel }: MatchActionBarProps) {
  const action = useSignup()

  if (reportHref) {
    return (
      <ActionBar>
        <Button asChild size="xl">
          <Link href={reportHref}>{reportLabel}</Link>
        </Button>
      </ActionBar>
    )
  }

  if (!action) return null
  const { primary, secondary, error } = action

  // The signup action as a secondary: whichever of the two is actionable.
  const signupAsSecondary = secondary ?? (primary.tone === 'action' ? primary : null)

  if (buildTeamsHref) {
    return (
      <ActionBar>
        <Button asChild size="xl">
          <Link href={buildTeamsHref}>
            <Users className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            {buildTeamsLabel}
          </Link>
        </Button>
        {signupAsSecondary && (
          <Button
            type="button"
            size="xl"
            variant="outline"
            onClick={signupAsSecondary.onClick}
            disabled={signupAsSecondary.disabled}
          >
            <ButtonContent button={signupAsSecondary} />
          </Button>
        )}
      </ActionBar>
    )
  }

  return (
    <ActionBar>
      <Button
        type="button"
        size="xl"
        variant={primary.tone === 'done' ? 'secondary' : 'default'}
        onClick={primary.onClick}
        disabled={primary.disabled}
        aria-live="polite"
      >
        <ButtonContent
          button={primary}
          icon={
            action.status === 'confirmed' ? (
              <Check className="h-5 w-5 text-success" strokeWidth={2} aria-hidden="true" />
            ) : undefined
          }
        />
      </Button>
      {secondary && (
        <Button type="button" size="xl" variant="outline" onClick={secondary.onClick} disabled={secondary.disabled}>
          <ButtonContent button={secondary} />
        </Button>
      )}
      {error && (
        <p className="sr-only" role="alert">
          {error}
        </p>
      )}
    </ActionBar>
  )
}
