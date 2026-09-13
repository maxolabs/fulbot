'use client'

import * as React from 'react'
import Link from 'next/link'
import { Check, Share2, SlidersHorizontal } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Popover } from '@/components/ui/popover'
import { Sheet } from '@/components/ui/sheet'
import { TopBarAction, useTopBar } from '@/components/layout/top-bar'
import { useT } from '@/i18n/provider'

// "Gestionar" on the match screen (docs/ui-rework/02-shell.md §2, 03-screens.md
// §3): a popover next to the page header in the browser, a bottom sheet from
// the top bar on mobile. The page passes the admin content as children so the
// server keeps the data fetching; this file only owns the chrome.

/** Mobile top bar for the match: group name as the back label, "Gestionar" (admin) or share on the right. */
export function MatchTopBar({
  groupName,
  groupHref,
  shareUrl,
  manageContent,
}: {
  groupName: string
  groupHref: string
  shareUrl: string
  /** Admin only: what the sheet shows. Members get the share action instead. */
  manageContent?: React.ReactNode
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)

  // Deep links from the dashboard ("Sumar invitado") land in the sheet on phones.
  React.useEffect(() => {
    if (!manageContent) return
    const hash = window.location.hash
    if (hash === '#invitado' || hash === '#gestionar') setOpen(true)
  }, [manageContent])

  const title = React.useMemo(
    () => (
      <Link
        href={groupHref}
        className="truncate text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-[3px]"
      >
        {groupName}
      </Link>
    ),
    [groupHref, groupName]
  )

  const action = React.useMemo(
    () =>
      manageContent ? (
        <TopBarAction onClick={() => setOpen(true)} label={t('ui.matchScreens.match.manage')}>
          <SlidersHorizontal className="h-5 w-5" strokeWidth={1.75} />
        </TopBarAction>
      ) : (
        <ShareMatchButton shareUrl={shareUrl} iconOnly />
      ),
    [manageContent, shareUrl, t]
  )

  useTopBar({ title, back: groupHref, action })

  if (!manageContent) return null

  return (
    <Sheet open={open} onOpenChange={setOpen} title={t('ui.matchScreens.match.manageTitle')}>
      <div className="space-y-6">{manageContent}</div>
    </Sheet>
  )
}

/** Browser: the "Gestionar" outline button opening the admin popover. */
export function ManagePopover({ children }: { children: React.ReactNode }) {
  const t = useT()
  return (
    <Popover
      align="right"
      aria-label={t('ui.matchScreens.match.manageTitle')}
      className="w-72 p-3"
      triggerClassName={buttonVariants({ variant: 'outline' })}
      trigger={
        <>
          <SlidersHorizontal className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          {t('ui.matchScreens.match.manage')}
        </>
      }
    >
      {children}
    </Popover>
  )
}

/** "Compartir": native share sheet when there is one, otherwise copies the public link. */
export function ShareMatchButton({ shareUrl, iconOnly = false }: { shareUrl: string; iconOnly?: boolean }) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)

  const handleShare = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ url: shareUrl })
        return
      } catch {
        // cancelled or unsupported: fall through to the clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard blocked: nothing else to do
    }
  }

  if (iconOnly) {
    return (
      <TopBarAction onClick={handleShare} label={copied ? t('ui.matchScreens.match.shareCopied') : t('ui.matchScreens.match.share')}>
        {copied ? (
          <Check className="h-5 w-5 text-success" strokeWidth={2} />
        ) : (
          <Share2 className="h-5 w-5" strokeWidth={1.75} />
        )}
      </TopBarAction>
    )
  }

  return (
    <Button type="button" variant="outline" onClick={handleShare} aria-live="polite">
      {copied ? (
        <Check className="h-4 w-4 text-success" strokeWidth={2} aria-hidden="true" />
      ) : (
        <Share2 className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      )}
      {copied ? t('ui.matchScreens.match.shareCopied') : t('ui.matchScreens.match.share')}
    </Button>
  )
}
