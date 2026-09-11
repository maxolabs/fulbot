'use client'

import * as React from 'react'
import { cn } from '@/lib/utils/cn'

// Segmented control (docs/ui-rework/04-components.md §2): mono labels inside a
// chalk outline, active segment on the raised surface. A radiogroup: arrows
// move the selection, Tab lands on the checked segment only.

export interface SegmentedOption<T extends string = string> {
  value: T
  label: React.ReactNode
}

export interface SegmentedProps<T extends string = string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Accessible name of the group; required for screen readers. */
  'aria-label'?: string
  'aria-labelledby'?: string
  size?: 'sm' | 'md'
  className?: string
}

export function Segmented<T extends string = string>({
  options,
  value,
  onChange,
  size = 'md',
  className,
  ...aria
}: SegmentedProps<T>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([])

  const select = (i: number) => {
    const opt = options[i]
    if (!opt) return
    onChange(opt.value)
    refs.current[i]?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const n = options.length
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        select((i + 1) % n)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        select((i - 1 + n) % n)
        break
      case 'Home':
        e.preventDefault()
        select(0)
        break
      case 'End':
        e.preventDefault()
        select(n - 1)
        break
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={aria['aria-label']}
      aria-labelledby={aria['aria-labelledby']}
      className={cn(
        'inline-flex max-w-full items-stretch rounded-[3px] border border-border bg-background p-0.5',
        className
      )}
    >
      {options.map((opt, i) => {
        const checked = opt.value === value
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'inline-flex min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-sm px-3 font-mono uppercase tracking-[.08em] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              size === 'sm' ? 'h-7 text-[10px]' : 'h-9 text-xs lg:h-8',
              checked
                ? 'bg-accent font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
