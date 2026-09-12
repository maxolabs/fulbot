'use client'

import { useState } from 'react'
import Link from 'next/link'
import { KeyRound, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { useT } from '@/i18n/provider'

// Mobile-only replacement for the two page-header actions on /groups
// (docs/ui-rework/03-screens.md §1): one outline button at the end of the
// list that opens a sheet with "Crear grupo" and "Unirme con código".

const rowClassName =
  'flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'

export function CreateOrJoinButton() {
  const t = useT()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        {t('ui.matchScreens.groups.createOrJoin')}
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title={t('ui.matchScreens.groups.createOrJoin')} className="px-0 lg:px-0">
        <ul className="py-1">
          <li>
            <Link href="/groups/new" className={rowClassName} onClick={() => setOpen(false)}>
              <Plus className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
              {t('ui.shell.createGroup')}
            </Link>
          </li>
          <li>
            <Link href="/invite" className={rowClassName} onClick={() => setOpen(false)}>
              <KeyRound className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
              {t('ui.shell.joinWithCode')}
            </Link>
          </li>
        </ul>
      </Sheet>
    </>
  )
}
