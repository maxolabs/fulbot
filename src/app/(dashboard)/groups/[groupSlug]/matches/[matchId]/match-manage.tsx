'use client'

import * as React from 'react'
import Link from 'next/link'
import { Share2, SlidersHorizontal } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Popover } from '@/components/ui/popover'
import { Sheet } from '@/components/ui/sheet'
import { TopBarAction, useTopBar } from '@/components/layout/top-bar'
import { ShareActions } from '@/components/share-actions'
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
  shareText,
  manageContent,
}: {
  groupName: string
  groupHref: string
  shareUrl: string
  shareText?: string
  /** Admin only: what the sheet shows. Members get the share action instead. */
  manageContent?: React.ReactNode
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)

  // Deep links from the dashboard ("Sumar invitado") land in the sheet on phones.
  React.useEffect(() => {
    if (!manageContent) return
    const hash = window.location.hash
    if (hash === '#gestionar') setOpen(true)
    if (hash === '#invitado') {
      // The form is rendered twice (mobile disclosure, desktop aside).
      if (window.matchMedia('(min-width: 1024px)').matches) {
        document.getElementById('invitado-lg')?.scrollIntoView()
      } else {
        const section = document.getElementById('invitado')
        if (section instanceof HTMLDetailsElement) section.open = true
      }
    }
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
        <ShareMatchButton shareUrl={shareUrl} shareText={shareText} iconOnly />
      ),
    [manageContent, shareUrl, shareText, t]
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

/** Use the same WhatsApp/copy flow for the match link on phones and desktop. */
export function ShareMatchButton({ shareUrl, shareText, iconOnly = false }: { shareUrl: string; shareText?: string; iconOnly?: boolean }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const text = shareText || shareUrl
  return (
    <>
      {iconOnly ? (
        <TopBarAction onClick={() => setOpen(true)} label={t('ui.matchScreens.match.share')}>
          <Share2 className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
        </TopBarAction>
      ) : (
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <Share2 className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          {t('ui.matchScreens.match.share')}
        </Button>
      )}
      <Sheet open={open} onOpenChange={setOpen} title={t('ui.matchScreens.match.share')}>
        <div className="space-y-4">
          <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans text-sm">{text}</pre>
          <ShareActions text={text} />
        </div>
      </Sheet>
    </>
  )
}
