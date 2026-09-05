'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Spinner } from '@/components/ui/spinner'
import { useT } from '@/i18n/provider'
import type { Language } from '@/i18n/use-translations'

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

  const inputClass =
    'flex h-11 w-full rounded-xl border border-border/50 bg-card/50 px-4 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 disabled:opacity-50 transition-colors'

  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">{t('auth.createAccount')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('auth.registerSubtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t('auth.name')}
          </label>
          <input
            id="name"
            type="text"
            placeholder="Tu nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={loading}
            className={inputClass}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            {t('auth.email')}
          </label>
          <input
            id="email"
            type="email"
            placeholder="tu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            className={inputClass}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            {t('auth.password')}
          </label>
          <input
            id="password"
            type="password"
            placeholder="Mínimo 6 caracteres"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            className={inputClass}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="confirmPassword" className="text-sm font-medium">
            {t('auth.confirmPassword')}
          </label>
          <input
            id="confirmPassword"
            type="password"
            placeholder="Repetí tu contraseña"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            disabled={loading}
            className={inputClass}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="language" className="text-sm font-medium">
            {t('auth.language')}
          </label>
          <select
            id="language"
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value as Language)}
            disabled={loading}
            className={inputClass}
          >
            <option value="es">{t('auth.languageEs')}</option>
            <option value="en">{t('auth.languageEn')}</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition-all hover:brightness-110 glow-sm hover:glow-md disabled:opacity-50"
        >
          {loading ? <Spinner size="sm" className="mr-2" /> : null}
          {t('auth.createAccount')}
        </button>
      </form>

      <p className="text-sm text-muted-foreground text-center">
        {t('auth.hasAccount')}{' '}
        <Link href="/login" className="text-primary font-medium hover:underline">
          {t('auth.loginCta')}
        </Link>
      </p>
    </div>
  )
}
