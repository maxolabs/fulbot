'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { FormNotice } from '@/components/form-controls'
import { useT } from '@/i18n/provider'
import { authErrorKey } from '@/lib/auth-errors'
import { safeRedirect } from '@/lib/safe-redirect'

// Password reset, step 2: the same password fields as register.

export function UpdatePasswordForm({ redirectParam }: { redirectParam?: string }) {
  const t = useT()
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState(false)
  const [loading, setLoading] = useState(false)
  const confirmRef = useRef<HTMLInputElement>(null)

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
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({ password })

      if (error) {
        setError(t(authErrorKey(error, 'ui.screens.auth.errorGeneric')))
        return
      }

      router.push(safeRedirect(redirectParam))
      router.refresh()
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
          {t('ui.screens.auth.updateTitle')}
        </h1>
        <p className="text-sm text-muted-foreground text-pretty">{t('ui.screens.auth.updateSubtitle')}</p>
      </div>

      <form onSubmit={handleSubmit} aria-busy={loading} className="space-y-5">
        {error && !passwordError && <FormNotice kind="error">{error}</FormNotice>}
        <div className="space-y-1.5">
          <Label htmlFor="password">{t('ui.screens.auth.newPassword')}</Label>
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
        <Button type="submit" size="xl" disabled={loading} className="w-full">
          {loading && <Spinner size="sm" />}
          {t('ui.screens.auth.savePassword')}
        </Button>
      </form>
    </div>
  )
}
