'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { FormNotice } from '@/components/form-controls'
import { useT } from '@/i18n/provider'
import { authErrorKey } from '@/lib/auth-errors'

// "Reenviar email" for an unconfirmed sign-up (register check-inbox state and
// the login error for an unconfirmed email). A chalk outline, never the cone:
// the screen's one primary action stays where it is. Supabase itself limits
// resends (about one a minute per address); the cooldown mirrors that.

const COOLDOWN_SECONDS = 60

export function confirmationRedirectUrl(redirectTo: string): string {
  return `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(redirectTo)}`
}

export function ResendConfirmation({
  email,
  redirectTo,
  initialCooldown = 0,
}: {
  email: string
  /** The safe post-confirmation target (already validated). */
  redirectTo: string
  /** Seconds to wait before the first resend (e.g. right after sign-up). */
  initialCooldown?: number
}) {
  const t = useT()
  const [cooldown, setCooldown] = useState(initialCooldown)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const trimmed = email.trim()

  const handleResend = async () => {
    setError(null)
    setSentTo(null)
    if (!trimmed) {
      setError(t('ui.screens.auth.resendNeedsEmail'))
      return
    }
    setLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: trimmed,
        options: { emailRedirectTo: confirmationRedirectUrl(redirectTo) },
      })
      if (error) {
        setError(t(authErrorKey(error, 'ui.screens.auth.errorGeneric')))
        if (error.status === 429) setCooldown(COOLDOWN_SECONDS)
        return
      }
      setSentTo(trimmed)
      setCooldown(COOLDOWN_SECONDS)
    } catch {
      setError(t('ui.screens.auth.errorNetwork'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      {error && <FormNotice kind="error">{error}</FormNotice>}
      {sentTo && <FormNotice kind="success">{t('ui.screens.auth.resendSent', { email: sentTo })}</FormNotice>}
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleResend}
        disabled={loading || cooldown > 0}
      >
        {loading && <Spinner size="sm" />}
        {cooldown > 0
          ? t('ui.screens.auth.resendIn', { seconds: cooldown })
          : t('ui.screens.auth.resend')}
      </Button>
    </div>
  )
}
