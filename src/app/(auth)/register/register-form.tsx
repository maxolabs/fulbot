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
import { ResendConfirmation, confirmationRedirectUrl } from '../resend-confirmation'

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
  const [nameError, setNameError] = useState(false)
  // Set when sign-up needs email confirmation (no session yet).
  const [sentTo, setSentTo] = useState<string | null>(null)
  // Set when the email already has a confirmed account: Supabase answers a
  // fake user with no identities and sends no email.
  const [existingEmail, setExistingEmail] = useState<string | null>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

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
    setNameError(false)

    const trimmedName = name.trim()
    if (!trimmedName) {
      setNameError(true)
      nameRef.current?.focus()
      return
    }

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
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: confirmationRedirectUrl(redirectTo),
          data: {
            name: trimmedName,
            preferred_language: language,
          },
        },
      })

      if (error) {
        setError(t(authErrorKey(error, 'auth.registerGenericError')))
        return
      }

      if (data.user && data.user.identities?.length === 0) {
        setExistingEmail(email.trim())
        return
      }

      setLanguageCookie(language)

      // Email confirmation is on: the link lands on /api/auth/confirm (or
      // /api/auth/callback with the default templates).
      if (!data.session) {
        setSentTo(email.trim())
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
            {t('ui.screens.auth.checkInboxBodyAnyDevice', { email: sentTo })}
          </p>
          <p className="text-sm text-muted-foreground text-pretty">{t('ui.screens.auth.checkInboxSpam')}</p>
        </div>
        <ResendConfirmation email={sentTo} redirectTo={redirectTo} initialCooldown={60} />
        <p className="text-center text-sm">
          <Link href={`/login${redirectQuery}`} className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
            {t('ui.screens.auth.backToLogin')}
          </Link>
        </p>
      </div>
    )
  }

  if (existingEmail) {
    return (
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-balance lg:text-3xl">
            {t('ui.screens.auth.emailInUseTitle')}
          </h1>
          <p role="status" className="text-sm text-muted-foreground text-pretty">
            {t('ui.screens.auth.emailInUseBody', { email: existingEmail })}
          </p>
        </div>
        <div className="space-y-3">
          <Button asChild size="xl" className="w-full">
            <Link href={`/login${redirectQuery}`}>{t('auth.loginCta')}</Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href={`/forgot-password${redirectQuery}`}>{t('ui.screens.auth.recoverPassword')}</Link>
          </Button>
        </div>
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
            ref={nameRef}
            autoComplete="name"
            maxLength={50}
            aria-invalid={nameError || undefined}
            aria-describedby={nameError ? 'name-error' : undefined}
            placeholder={t('ui.screens.auth.namePlaceholder')}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (nameError) setNameError(false)
            }}
            required
            disabled={loading}
          />
          {nameError && <p id="name-error" role="alert" className="text-sm text-destructive">{t('ui.screens.auth.nameRequired')}</p>}
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
        {/* Opens in a new tab so the half-filled form is not lost. */}
        <p className="text-center text-xs text-muted-foreground text-pretty">
          {t('ui.legal.consentPrefix')}{' '}
          <Link href="/terms" target="_blank" rel="noopener" className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
            {t('ui.legal.consentTerms')}
          </Link>{' '}
          {t('ui.legal.consentAnd')}{' '}
          <Link href="/privacy" target="_blank" rel="noopener" className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
            {t('ui.legal.consentPrivacy')}
          </Link>
          .
        </p>
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
