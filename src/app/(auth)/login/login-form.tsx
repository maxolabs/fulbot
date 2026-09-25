'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { FormNotice } from '@/components/form-controls'
import { useT } from '@/i18n/provider'
import { authErrorKey } from '@/lib/auth-errors'
import { safeRedirect } from '@/lib/safe-redirect'
import { setLanguageCookie } from '../language-cookie'

// Login (docs/ui-rework/03-screens.md §11): max-w-sm form on the board,
// mono eyebrow labels, 44px inputs, one cone button.

function LoginFormFields() {
  const t = useT()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawRedirect = searchParams.get('redirect')
  const redirectTo = safeRedirect(rawRedirect)
  // Carried to the register and forgot-password links so the target survives.
  const redirectQuery = rawRedirect && redirectTo === rawRedirect ? `?redirect=${encodeURIComponent(redirectTo)}` : ''

  // /api/auth/callback sends ?error=auth_failed when a confirmation or reset
  // link could not be exchanged for a session.
  const [error, setError] = useState<string | null>(
    searchParams.get('error') === 'auth_failed' ? t('ui.screens.auth.errorLinkInvalid') : null
  )
  const [loading, setLoading] = useState(false)

  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        setError(t(authErrorKey(error, 'auth.loginGenericError')))
        return
      }

      // Public pages and <html lang> read the fulbot_lang cookie: sync it with
      // the account's language (A-I1).
      const { data: profile } = await supabase
        .from('users')
        .select('preferred_language')
        .eq('id', data.user.id)
        .single()
      if (profile?.preferred_language) setLanguageCookie(profile.preferred_language)

      router.push(redirectTo)
      router.refresh()
    } catch {
      setError(t('auth.loginGenericError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-balance lg:text-3xl">{t('auth.login')}</h1>
        <p className="text-sm text-muted-foreground">{t('auth.loginSubtitle')}</p>
      </div>

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
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="password">{t('auth.password')}</Label>
            <Link
              href={`/forgot-password${redirectQuery}`}
              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              {t('auth.forgotPassword')}
            </Link>
          </div>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <Button type="submit" size="xl" disabled={loading} className="w-full">
          {loading && <Spinner size="sm" />}
          {t('auth.login')}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {t('auth.noAccount')}{' '}
        <Link href={`/register${redirectQuery}`} className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
          {t('auth.registerCta')}
        </Link>
      </p>
    </div>
  )
}

export function LoginForm() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
        </div>
      }
    >
      <LoginFormFields />
    </Suspense>
  )
}
