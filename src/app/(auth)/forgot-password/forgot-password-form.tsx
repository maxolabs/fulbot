'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { FormNotice } from '@/components/form-controls'
import { useT } from '@/i18n/provider'
import { authErrorKey } from '@/lib/auth-errors'
import { safeRedirect } from '@/lib/safe-redirect'

// Password reset, step 1: same frame as login. Supabase mails a link to
// /api/auth/callback (or /api/auth/confirm with the templates in
// supabase/templates/), which opens a session and continues to /update-password.

export function ForgotPasswordForm({ redirectParam }: { redirectParam?: string }) {
  const t = useT()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const redirectTo = safeRedirect(redirectParam)
  const redirectQuery = redirectParam && redirectTo === redirectParam ? `?redirect=${encodeURIComponent(redirectTo)}` : ''

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const supabase = createClient()
      const next = `/update-password${redirectQuery}`
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(next)}`,
      })

      if (error) {
        setError(t(authErrorKey(error, 'ui.screens.auth.errorGeneric')))
        return
      }

      setSentTo(email)
    } catch {
      setError(t('ui.screens.auth.errorGeneric'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-balance lg:text-3xl">
          {t('ui.screens.auth.forgotTitle')}
        </h1>
        <p className="text-sm text-muted-foreground text-pretty">{t('ui.screens.auth.forgotSubtitle')}</p>
      </div>

      {sentTo ? (
        <FormNotice kind="success">{t('ui.screens.auth.resetSentAnyDevice', { email: sentTo })}</FormNotice>
      ) : (
        <form onSubmit={handleSubmit} aria-busy={loading} className="space-y-5">
          {error && <FormNotice kind="error">{error}</FormNotice>}
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('auth.email')}</Label>
            <Input
              id="email"
              name="email"
              spellCheck={false}
              autoCapitalize="none"
              type="email"
              autoComplete="email"
              placeholder={t('ui.screens.auth.emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          <Button type="submit" size="xl" disabled={loading} className="w-full">
            {loading && <Spinner size="sm" />}
            {t('ui.screens.auth.sendResetLink')}
          </Button>
        </form>
      )}

      <p className="text-center text-sm">
        <Link href={`/login${redirectQuery}`} className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
          {t('ui.screens.auth.backToLogin')}
        </Link>
      </p>
    </div>
  )
}
