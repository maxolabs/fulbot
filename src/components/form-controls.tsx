import * as React from 'react'
import { Check, ChevronDown, CircleAlert } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

// Small form pieces shared by the forms of the UI rework (docs/ui-rework/
// 06-principles.md §7): an inline notice, a native <select> dressed like the
// Input primitive, and a switch. No 'use client': the callers are client
// forms already; a server page may render FormNotice and NativeSelect too.

/** Inline form feedback. Errors go under the control or at the top of the card, never a toast. */
export function FormNotice({
  kind,
  children,
  className,
}: {
  kind: 'error' | 'success'
  children: React.ReactNode
  className?: string
}) {
  const Icon = kind === 'error' ? CircleAlert : Check
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm',
        kind === 'error'
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-success/40 bg-success/10 text-foreground',
        className
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export const nativeSelectClassName =
  'flex h-11 w-full appearance-none rounded-md border border-border bg-background py-2 pl-3 pr-9 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50'

/** A native <select> with the Input look (44px, chalk border) and a chevron. */
export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string }
>(({ className, wrapperClassName, children, ...props }, ref) => (
  <div className={cn('relative', wrapperClassName)}>
    <select ref={ref} className={cn(nativeSelectClassName, className)} {...props}>
      {children}
    </select>
    <ChevronDown
      className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      strokeWidth={1.75}
      aria-hidden="true"
    />
  </div>
))
NativeSelect.displayName = 'NativeSelect'

/** Switch: cone track when on, raised surface when off; the knob keeps contrast in both states. */
export function Toggle({
  id,
  checked,
  onChange,
  disabled,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  className,
}: {
  id?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  'aria-label'?: string
  'aria-labelledby'?: string
  className?: string
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'border-border bg-muted',
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-4 w-4 rounded-full transition-transform duration-100',
          checked ? 'translate-x-6 bg-primary-foreground' : 'translate-x-1 bg-foreground'
        )}
      />
    </button>
  )
}
