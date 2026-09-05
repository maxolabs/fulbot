'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Spinner } from '@/components/ui/spinner'
import { useT } from '@/i18n/provider'

function LoginFormFields() {
  const t = useT()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect') || '/groups'

  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        if (error.message === 'Invalid login credentials') {
          setError(t('auth.loginError'))
        } else {
          setError(error.message)
        }
        return
      }

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
        <h1 className="text-2xl font-bold tracking-tight">{t('auth.login')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('auth.loginSubtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
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
            className="flex h-11 w-full rounded-xl border border-border/50 bg-card/50 px-4 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 disabled:opacity-50 transition-colors"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            {t('auth.password')}
          </label>
          <input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            className="flex h-11 w-full rounded-xl border border-border/50 bg-card/50 px-4 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 disabled:opacity-50 transition-colors"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition-all hover:brightness-110 glow-sm hover:glow-md disabled:opacity-50"
        >
          {loading ? <Spinner size="sm" className="mr-2" /> : null}
          {t('auth.login')}
        </button>
      </form>

      <p className="text-sm text-muted-foreground text-center">
        {t('auth.noAccount')}{' '}
        <Link href="/register" className="text-primary font-medium hover:underline">
          {t('auth.registerCta')}
        </Link>
      </p>
    </div>
  )
}

export function LoginForm() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    }>
      <LoginFormFields />
    </Suspense>
  )
}
