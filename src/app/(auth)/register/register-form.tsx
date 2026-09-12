'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { FormNotice, NativeSelect } from '@/components/form-controls'
import { useT } from '@/i18n/provider'
import type { Language } from '@/i18n/use-translations'

// Register (docs/ui-rework/03-screens.md §11): same frame as login.

interface RegisterFormProps {
  initialLanguage: Language
}

function setLanguageCookie(language: Language) {
  if (typeof document === 'undefined') return
  document.cookie = `fulbot_lang=${language}; path=/; max-age=31536000; samesite=lax`
}

export function RegisterForm({ initialLanguage }: RegisterFormProps) {
  const t = useT()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [language, setLanguage] = useState<Language>(initialLanguage)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const router = useRouter()
  const supabase = createClient()

  const handleLanguageChange = (value: Language) => {
    setLanguage(value)
    setLanguageCookie(value)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError(t('auth.passwordMismatch'))
      return
    }

    if (password.length < 6) {
      setError(t('auth.passwordTooShort'))
      return
    }

    setLoading(true)

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
            preferred_language: language,
          },
        },
      })

      if (error) {
        if (error.message.includes('already registered')) {
          setError(t('auth.emailInUse'))
        } else {
          setError(error.message)
        }
        return
      }

      setLanguageCookie(language)
      router.push('/groups')
      router.refresh()
    } catch {
      setError(t('auth.registerGenericError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-balance lg:text-3xl">
          {t('auth.createAccount')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('auth.registerSubtitle')}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <FormNotice kind="error">{error}</FormNotice>}
        <div className="space-y-1.5">
          <Label htmlFor="name">{t('auth.name')}</Label>
          <Input
            id="name"
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
            type="email"
            autoComplete="email"
            placeholder="tu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t('auth.password')}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder={t('ui.screens.auth.passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">{t('auth.confirmPassword')}</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder={t('ui.screens.auth.confirmPlaceholder')}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="language">{t('auth.language')}</Label>
          <NativeSelect
            id="language"
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
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
          {t('auth.loginCta')}
        </Link>
      </p>
    </div>
  )
}
