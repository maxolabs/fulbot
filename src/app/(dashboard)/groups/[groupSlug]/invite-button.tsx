'use client'

import { useState } from 'react'
import { Check, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/provider'

// "Invitar" (docs/ui-rework/03-screens.md §2): copies the group invite link,
// the same clipboard logic the old invite card used through CopyButton.
export function InviteButton({ inviteUrl, className }: { inviteUrl: string; className?: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button type="button" variant="outline" onClick={handleCopy} className={className} aria-live="polite">
      {copied ? (
        <Check className="h-4 w-4 text-success" strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <Link2 className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      )}
      {copied ? t('ui.matchScreens.dashboard.inviteCopied') : t('ui.matchScreens.dashboard.invite')}
    </Button>
  )
}
