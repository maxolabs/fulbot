'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { FormNotice, NativeSelect } from '@/components/form-controls'
import { useT } from '@/i18n/provider'
import type { Language } from '@/i18n/use-translations'
import { authErrorKey } from '@/lib/auth-errors'
import { safeRedirect } from '@/lib/safe-redirect'
import { setLanguageCookie } from '../language-cookie'

// Register (docs/ui-rework/03-screens.md §11): same frame as login.

interface RegisterFormProps {
  initialLanguage: Language
  /** Raw ?redirect= from the URL (e.g. the invite page); validated here. */
  redirectParam?: string
}

export function RegisterForm({ initialLanguage, redirectParam }: RegisterFormProps) {
  const t = useT()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [language, setLanguage] = useState<Language>(initialLanguage)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [passwordError, setPasswordError] = useState(false)
  // Set when sign-up needs email confirmation (no session yet).
  const [sentTo, setSentTo] = useState<string | null>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  const router = useRouter()
  const supabase = createClient()
  const redirectTo = safeRedirect(redirectParam)
  const redirectQuery = redirectParam && redirectTo === redirectParam ? `?redirect=${encodeURIComponent(redirectTo)}` : ''

  const handleLanguageChange = (value: Language) => {
    setLanguage(value)
    setLanguageCookie(value)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setPasswordError(false)

    if (password !== confirmPassword) {
      setError(t('auth.passwordMismatch'))
      setPasswordError(true)
      confirmRef.current?.focus()
      return
    }

    if (password.length < 6) {
      setError(t('auth.passwordTooShort'))
      return
    }

    setLoading(true)

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(redirectTo)}`,
          data: {
            name,
            preferred_language: language,
          },
        },
      })

      if (error) {
        setError(t(authErrorKey(error, 'auth.registerGenericError')))
        return
      }

      setLanguageCookie(language)

      // Email confirmation is on: the link lands on /api/auth/callback.
      if (!data.session) {
        setSentTo(email)
        return
      }

      router.push(redirectTo)
      router.refresh()
    } catch {
      setError(t('auth.registerGenericError'))
    } finally {
      setLoading(false)
    }
  }

  if (sentTo) {
    return (
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-balance lg:text-3xl">
            {t('ui.screens.auth.checkInboxTitle')}
          </h1>
          <p role="status" className="text-sm text-muted-foreground text-pretty">
            {t('ui.screens.auth.checkInboxBody', { email: sentTo })}
          </p>
        </div>
        <p className="text-center text-sm">
          <Link href={`/login${redirectQuery}`} className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
            {t('ui.screens.auth.backToLogin')}
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-balance lg:text-3xl">
          {t('auth.createAccount')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('auth.registerSubtitle')}</p>
      </div>

      <form onSubmit={handleSubmit} aria-busy={loading} className="space-y-5">
        {error && !passwordError && <FormNotice kind="error">{error}</FormNotice>}
        <div className="space-y-1.5">
          <Label htmlFor="name">{t('auth.name')}</Label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            placeholder={t('ui.screens.auth.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={loading}
          />
        </div>
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
          <Label htmlFor="password">{t('auth.password')}</Label>
          <PasswordInput
            id="password"
            name="password"
            minLength={6}
            aria-describedby="password-hint"
            autoComplete="new-password"
            placeholder={t('ui.screens.auth.passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
          />
          <p id="password-hint" className="text-xs text-muted-foreground">{t('auth.passwordHint')}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">{t('auth.confirmPassword')}</Label>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            ref={confirmRef}
            minLength={6}
            aria-invalid={passwordError || undefined}
            aria-describedby={passwordError ? 'confirm-password-error' : undefined}
            autoComplete="new-password"
            placeholder={t('ui.screens.auth.confirmPlaceholder')}
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value)
              if (passwordError) {
                setPasswordError(false)
                setError(null)
              }
            }}
            required
            disabled={loading}
          />
          {passwordError && <p id="confirm-password-error" role="alert" className="text-sm text-destructive">{t('auth.passwordMismatch')}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="language">{t('auth.language')}</Label>
          <NativeSelect
            id="language"
            name="language"
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value as Language)}
            disabled={loading}
          >
            <option value="es">{t('auth.languageEs')}</option>
            <option value="en">{t('auth.languageEn')}</option>
          </NativeSelect>
        </div>
        <Button type="submit" size="xl" disabled={loading} className="w-full">
          {loading && <Spinner size="sm" />}
          {t('auth.createAccount')}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {t('auth.hasAccount')}{' '}
        <Link href={`/login${redirectQuery}`} className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
          {t('auth.loginCta')}
        </Link>
      </p>
    </div>
  )
}
