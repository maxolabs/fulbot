'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { useT } from '@/i18n/provider'
import { cn } from '@/lib/utils/cn'

// Sheet (docs/ui-rework/04-components.md §2): a native <dialog>. Bottom sheet
// below `lg` (slides up in 150ms, drag handle, 85vh max, safe-area padding),
// centred dialog at `lg`. Escape and a backdrop click close it, the element
// traps focus by itself, focus returns to whatever opened it, and the page
// behind does not scroll while it is open. The only surface with a shadow,
// together with Popover.

export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  children: React.ReactNode
  /** Optional one-line description under the title. */
  description?: React.ReactNode
  /** Extra classes for the scrolling content area. */
  className?: string
}

export function Sheet({ open, onOpenChange, title, children, description, className }: SheetProps) {
  const t = useT()
  const ref = React.useRef<HTMLDialogElement>(null)
  const openerRef = React.useRef<HTMLElement | null>(null)
  const titleId = React.useId()
  const descriptionId = React.useId()

  React.useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    if (open) {
      if (dialog.open) return
      openerRef.current = (document.activeElement as HTMLElement | null) ?? null
      const previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      dialog.showModal()
      return () => {
        document.body.style.overflow = previousOverflow
      }
    }

    if (dialog.open) dialog.close()
  }, [open])

  // The native `close` event fires for Escape, for form method="dialog" and
  // for our own close(). Route all of them through onOpenChange once.
  const handleClose = () => {
    onOpenChange(false)
    const opener = openerRef.current
    openerRef.current = null
    if (opener && typeof opener.focus === 'function') {
      requestAnimationFrame(() => opener.focus())
    }
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    // The dialog box has no padding; a click that lands on the element itself
    // (not on a child) is a click on the ::backdrop.
    if (e.target === e.currentTarget) onOpenChange(false)
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={handleClose}
      onCancel={(e) => {
        e.preventDefault()
        onOpenChange(false)
      }}
      onClick={handleBackdropClick}
      className={cn(
        // reset the UA box, then place it
        'fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none p-0',
        'max-h-[85vh] overflow-y-auto overscroll-contain',
        'rounded-t-lg border border-b-0 border-border bg-card text-card-foreground shadow-lg shadow-black/40',
        'open:animate-sheet-up backdrop:bg-black/50',
        // browser: centred dialog
        'lg:inset-0 lg:m-auto lg:h-max lg:max-w-md lg:rounded-md lg:border-b lg:animate-none'
      )}
    >
      {open && (
        <div className="pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border lg:hidden" aria-hidden="true" />
          <div className="flex items-start justify-between gap-4 px-4 pb-2 pt-3 lg:px-5 lg:pt-5">
            <div className="min-w-0 space-y-1">
              <h2 id={titleId} className="font-display text-base font-bold leading-tight text-balance">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="text-sm text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label={t('ui.close')}
              className="-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
          <div className={cn('px-4 pb-4 lg:px-5 lg:pb-5', className)}>{children}</div>
        </div>
      )}
    </dialog>
  )
}
