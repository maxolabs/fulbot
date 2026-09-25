'use client'

import { useId, useState } from 'react'
import { Check, Copy, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/provider'
import { Sheet } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ShareActions } from '@/components/share-actions'

// Keep the selectable link as a fallback alongside WhatsApp and copy actions.
export function InviteButton({ inviteUrl, className }: { inviteUrl: string; className?: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const inputId = useId()
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* The field stays selectable for a manual copy. */ }
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)} className={className}>
        <Link2 className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        {t('ui.matchScreens.dashboard.invite')}
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title={t('ui.matchScreens.dashboard.invite')} description={t('sharing.inviteDescription')}>
        <div className="space-y-1.5 pt-3">
          <Label htmlFor={inputId}>{t('ui.polish.inviteLink')}</Label>
          <div className="flex gap-2">
            <Input id={inputId} value={inviteUrl} readOnly onFocus={(event) => event.currentTarget.select()} className="font-mono" />
            <Button type="button" variant="outline" size="icon" onClick={copyLink} aria-label={t(copied ? 'sharing.copied' : 'ui.polish.copyLink')} className="shrink-0">
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </div>
        </div>
        <div className="mt-4"><ShareActions text={`${t('sharing.inviteMessage')}\n${inviteUrl}`} /></div>
      </Sheet>
    </>
  )
}
