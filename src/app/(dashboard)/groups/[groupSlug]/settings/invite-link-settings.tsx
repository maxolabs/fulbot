'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { FormNotice } from '@/components/form-controls'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/provider'

// Invite link with a "Regenerar link" action (regenerate_invite_code, 00028).
// Rotating the code is how an admin revokes a leaked link; the old one stops
// working at once, so the action asks first in a Sheet.

interface InviteLinkSettingsProps {
  groupId: string
  baseUrl: string
  inviteCode: string
}

export function InviteLinkSettings({ groupId, baseUrl, inviteCode }: InviteLinkSettingsProps) {
  const t = useT()
  const router = useRouter()
  const supabase = createClient()
  const inputId = useId()

  const [code, setCode] = useState(inviteCode)
  const [copied, setCopied] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [regenerated, setRegenerated] = useState(false)

  const inviteUrl = `${baseUrl}/invite/${code}`

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* The field stays selectable for a manual copy. */ }
  }

  async function regenerate() {
    setLoading(true)
    setError(null)
    try {
      const { data, error: rpcError } = await (supabase as any).rpc('regenerate_invite_code', {
        p_group_id: groupId,
      })
      if (rpcError) throw rpcError
      if (typeof data !== 'string' || !data) throw new Error('No invite code returned')
      setCode(data)
      setRegenerated(true)
      setConfirmOpen(false)
      router.refresh()
    } catch (err) {
      console.error('Error regenerating invite code:', err)
      setError(t('ui.screens.groupSettings.regenerateError'))
      setConfirmOpen(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      {error && <FormNotice kind="error">{error}</FormNotice>}
      {regenerated && <FormNotice kind="success">{t('ui.screens.groupSettings.regenerated')}</FormNotice>}

      <div className="space-y-1.5">
        <Label htmlFor={inputId}>{t('ui.polish.inviteLink')}</Label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            value={inviteUrl}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={copyLink}
            aria-label={t(copied ? 'sharing.copied' : 'ui.polish.copyLink')}
            className="shrink-0"
          >
            {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          </Button>
        </div>
      </div>

      <Button type="button" variant="outline" onClick={() => setConfirmOpen(true)} disabled={loading}>
        <RefreshCw className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        {t('ui.screens.groupSettings.regenerate')}
      </Button>

      <Sheet
        open={confirmOpen}
        onOpenChange={(open) => { if (!loading) setConfirmOpen(open) }}
        title={t('ui.screens.groupSettings.regenerateConfirm')}
        description={t('ui.screens.groupSettings.regenerateBody')}
      >
        <div className="flex flex-wrap gap-3 pt-4">
          <Button variant="destructive" disabled={loading} onClick={regenerate}>
            {loading && <Spinner size="sm" />}
            {t('ui.screens.groupSettings.regenerate')}
          </Button>
          <Button variant="outline" disabled={loading} onClick={() => setConfirmOpen(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Sheet>
    </div>
  )
}
