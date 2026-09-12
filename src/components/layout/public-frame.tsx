import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils/cn'
import { Wordmark } from './wordmark'

// PublicFrame (docs/ui-rework/02-shell.md §4): the frame for routes without
// a shell (auth, landing, invite, public match). Always the board: the
// wrapper carries the `dark` class so every token resolves to the Pizarra
// palette regardless of the theme cookie, plus the chalk-dust texture. A
// centred column with the wordmark at the top; no tabs, no sidebar.

export interface PublicFrameProps {
  children: React.ReactNode
  width?: 'sm' | 'md'
  className?: string
}

export function PublicFrame({ children, width = 'md', className }: PublicFrameProps) {
  return (
    <div className="dark chalk-dust flex min-h-dvh flex-col items-center bg-background px-4 py-8 text-foreground">
      <Link
        href="/"
        className="mb-8 rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Wordmark size="lg" withMark />
      </Link>
      <div
        className={cn(
          'flex w-full flex-1 flex-col',
          width === 'sm' ? 'max-w-sm' : 'max-w-md',
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}
