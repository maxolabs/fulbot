'use client'

import * as React from 'react'
import { cn } from '@/lib/utils/cn'

// Popover (docs/ui-rework/04-components.md §2): an anchored panel using the
// same backdrop pattern as the old header's user menu (a `fixed
// inset-0` layer under the panel catches the outside click). Escape closes,
// focus returns to the trigger. The trigger content is wrapped in the
// popover's own <button>; style it through `triggerClassName` (for example
// `buttonVariants({ variant: 'outline' })`).

export interface PopoverProps {
  trigger: React.ReactNode
  /** Panel content. A function receives `{ close }` to close after an action. */
  children: React.ReactNode | ((ctx: { close: () => void }) => React.ReactNode)
  /** Which edge of the trigger the panel is anchored to. */
  align?: 'left' | 'right'
  /** Controlled mode; leave both out to let the popover manage itself. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  triggerClassName?: string
  /** Extra classes for the panel (width, padding). */
  className?: string
  /** Accessible name for the trigger when its content is not text. */
  'aria-label'?: string
}

export function Popover({
  trigger,
  children,
  align = 'left',
  open: openProp,
  onOpenChange,
  triggerClassName,
  className,
  'aria-label': ariaLabel,
}: PopoverProps) {
  const [openState, setOpenState] = React.useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : openState
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const wasOpenRef = React.useRef(false)
  const panelId = React.useId()

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!controlled) setOpenState(next)
      onOpenChange?.(next)
    },
    [controlled, onOpenChange]
  )

  React.useEffect(() => {
    if (!open) {
      // Closed after having been open: hand focus back to the trigger.
      if (wasOpenRef.current) {
        wasOpenRef.current = false
        triggerRef.current?.focus()
      }
      return
    }
    wasOpenRef.current = true
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    // Move focus into the panel so keyboard users land on its first control.
    const first = panelRef.current?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    first?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  const close = () => setOpen(false)

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen(!open)}
        className={cn(
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          triggerClassName
        )}
      >
        {trigger}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} aria-hidden="true" />
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            className={cn(
              'absolute z-20 mt-2 min-w-56 rounded-md border border-border bg-popover text-popover-foreground shadow-lg shadow-black/40',
              align === 'right' ? 'right-0' : 'left-0',
              className
            )}
          >
            {typeof children === 'function' ? children({ close }) : children}
          </div>
        </>
      )}
    </div>
  )
}
