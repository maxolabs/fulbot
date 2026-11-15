'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { FormNotice } from '@/components/form-controls'
import { createClient } from '@/lib/supabase/client'
import { authErrorKey } from '@/lib/auth-errors'
import { useT } from '@/i18n/provider'
import { cn } from '@/lib/utils/cn'

// Account rows in /settings (OD-5): the email with "Cambiar email" (Supabase
// sends confirmation links; the change applies once confirmed), "Cambiar
// contraseña", and "Borrar mi cuenta" as a destructive row that asks in a
// Sheet and wants the email typed before it calls /api/account/delete.

interface AccountSectionProps {
  email: string
  /** auth user's new_email while an email change waits for confirmation. */
  pendingEmail: string | null
  /** Groups where the user is the only admin and there are other members. */
  deletionBlockers: string[]
}

const rowClassName = 'flex min-h-11 items-center justify-between gap-4 border-b border-border py-3'

export function AccountSection({ email, pendingEmail, deletionBlockers }: AccountSectionProps) {
  const t = useT()
  const router = useRouter()
  const supabase = createClient()

  // Change email
  const [emailOpen, setEmailOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null)

  // Delete account
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const blocked = deletionBlockers.length > 0
  const blockedText = t('ui.account.deleteBlocked', { groups: deletionBlockers.join(', ') })
  const confirmMatches = confirmText.trim().toLowerCase() === email.trim().toLowerCase()

  const openEmailSheet = () => {
    setNewEmail('')
    setEmailError(null)
    setEmailSentTo(null)
    setEmailOpen(true)
  }

  const requestEmailChange = async (e: React.FormEvent) => {
    e.preventDefault()
    const target = newEmail.trim()
    if (!target) return
    if (target.toLowerCase() === email.trim().toLowerCase()) {
      setEmailError(t('ui.account.sameEmail'))
      return
    }
    setEmailLoading(true)
    setEmailError(null)
    try {
      const { error } = await supabase.auth.updateUser(
        { email: target },
        { emailRedirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent('/settings')}` }
      )
      if (error) {
        setEmailError(t(authErrorKey(error, 'ui.account.emailError')))
        return
      }
      setEmailSentTo(target)
      router.refresh()
    } catch {
      setEmailError(t('ui.screens.auth.errorNetwork'))
    } finally {
      setEmailLoading(false)
    }
  }

  const openDeleteSheet = () => {
    setConfirmText('')
    setDeleteError(null)
    setDeleteOpen(true)
  }

  const deleteAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!confirmMatches) return
    setDeleteLoading(true)
    setDeleteError(null)
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { error?: string; groups?: string }
      if (!res.ok) {
        if (data.error === 'last_admin_of_group') {
          setDeleteError(t('ui.account.deleteBlocked', { groups: data.groups || deletionBlockers.join(', ') }))
        } else if (data.error === 'not_authenticated') {
          setDeleteError(t('ui.screens.auth.errorSessionExpired'))
        } else {
          setDeleteError(t('ui.account.deleteError'))
        }
        setDeleteLoading(false)
        return
      }
      // The route already cleared the session cookies; drop the in-memory
      // session too, then a full load so nothing signed-in stays rendered.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
      window.location.assign('/?account=deleted')
    } catch {
      setDeleteError(t('ui.account.deleteError'))
      setDeleteLoading(false)
    }
  }

  return (
    <>
      <ul className="[&>li:last-child]:border-b-0">
        <li className={rowClassName}>
          <span className="text-sm font-medium">{t('ui.screens.preferences.accountEmail')}</span>
          <span className="min-w-0 truncate text-sm text-muted-foreground">{email}</span>
        </li>
        {pendingEmail && (
          <li className="border-b border-border py-3">
            <p role="status" className="text-xs text-muted-foreground text-pretty">
              {t('ui.account.emailPending', { email: pendingEmail })}
            </p>
          </li>
        )}
        <li className="flex min-h-11 flex-wrap items-center justify-end gap-2 border-b border-border py-3">
          <Button variant="outline" size="sm" onClick={openEmailSheet}>
            {t('ui.account.changeEmail')}
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/update-password?redirect=/settings">{t('ui.screens.preferences.changePassword')}</Link>
          </Button>
        </li>
      </ul>

      <div className="mt-3 border-t border-border">
        <button
          type="button"
          onClick={openDeleteSheet}
          disabled={blocked}
          className="flex min-h-11 w-full items-center gap-3 py-3 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          {/* Disabled: only the action fades; the reason stays readable (06-principles §7). */}
          <Trash2 className={cn('h-4 w-4 shrink-0 text-destructive', blocked && 'opacity-50')} strokeWidth={1.75} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className={cn('block text-sm font-medium text-destructive', blocked && 'opacity-50')}>{t('ui.account.delete')}</span>
            <span className="block text-xs text-muted-foreground text-pretty">
              {blocked ? blockedText : t('ui.account.deleteHint')}
            </span>
          </span>
          <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground', blocked && 'opacity-50')} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <Sheet
        open={emailOpen}
        onOpenChange={(next) => { if (!emailLoading) setEmailOpen(next) }}
        title={t('ui.account.changeEmailTitle')}
        description={emailSentTo ? undefined : t('ui.account.changeEmailBody')}
      >
        {emailSentTo ? (
          <div className="space-y-4 pt-4">
            <FormNotice kind="success">{t('ui.account.emailSent', { email: emailSentTo })}</FormNotice>
            <Button variant="outline" onClick={() => setEmailOpen(false)}>
              {t('common.close')}
            </Button>
          </div>
        ) : (
          <form onSubmit={requestEmailChange} className="space-y-4 pt-4" aria-busy={emailLoading}>
            {emailError && <FormNotice kind="error">{emailError}</FormNotice>}
            <div className="space-y-1.5">
              <Label htmlFor="new-email">{t('ui.account.newEmail')}</Label>
              <Input
                id="new-email"
                type="email"
                autoComplete="email"
                spellCheck={false}
                autoCapitalize="none"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder={t('ui.screens.auth.emailPlaceholder')}
                required
                disabled={emailLoading}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={emailLoading || !newEmail.trim()}>
                {emailLoading && <Spinner size="sm" />}
                {t('ui.account.sendLink')}
              </Button>
              <Button type="button" variant="outline" disabled={emailLoading} onClick={() => setEmailOpen(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        )}
      </Sheet>

      <Sheet
        open={deleteOpen}
        onOpenChange={(next) => { if (!deleteLoading) setDeleteOpen(next) }}
        title={t('ui.account.deleteTitle')}
        description={t('ui.account.deleteBody')}
      >
        <form onSubmit={deleteAccount} className="space-y-4 pt-4" aria-busy={deleteLoading}>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground text-pretty">
            <li>{t('ui.account.deleteItemGroups')}</li>
            <li>{t('ui.account.deleteItemProfile')}</li>
            <li>{t('ui.account.deleteItemData')}</li>
            <li>{t('ui.account.deleteItemSolo')}</li>
          </ul>
          {deleteError && <FormNotice kind="error">{deleteError}</FormNotice>}
          <div className="space-y-1.5">
            <Label htmlFor="delete-confirm">{t('ui.account.deleteConfirmLabel')}</Label>
            <Input
              id="delete-confirm"
              type="email"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={email}
              disabled={deleteLoading}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="destructive" disabled={deleteLoading || !confirmMatches}>
              {deleteLoading && <Spinner size="sm" />}
              {t('ui.account.deleteConfirm')}
            </Button>
            <Button type="button" variant="outline" disabled={deleteLoading} onClick={() => setDeleteOpen(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </Sheet>
    </>
  )
}
