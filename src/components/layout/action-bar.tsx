import * as React from 'react'
import { cn } from '@/lib/utils/cn'

// ActionBar (docs/ui-rework/02-shell.md §2, 04-components.md §3): the sticky
// bottom container for the screen's primary action on mobile. Sits above the
// tab bar (`bottom-14`) inside the app and on the viewport edge (`bottom-0`)
// on public pages, where it also shows in the browser. A gradient from
// transparent to the background lets the list fade under it. Children are a
// row: the first child grows (the primary), anything after it keeps its
// width (the secondary, `variant="outline"`); both should be `size="xl"`.
// Pages that use it end their content with `pb-32`.
//
//   <ActionBar>
//     <Button size="xl">Anotarme</Button>
//     <Button size="xl" variant="outline">Compartir</Button>
//   </ActionBar>

export interface ActionBarProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  /** Public pages: no tab bar underneath and visible at every width. */
  public?: boolean
}

export function ActionBar({ children, public: isPublic = false, className, ...props }: ActionBarProps) {
  return (
    <div
      className={cn(
        'sticky z-30 -mx-4 bg-gradient-to-t from-background via-background to-transparent px-4 pb-3 pt-6',
        isPublic ? 'bottom-0' : 'bottom-14 lg:hidden',
        className
      )}
      {...props}
    >
      <div
        className={cn(
          'flex items-center gap-3 [&>*:first-child]:min-w-0 [&>*:first-child]:flex-1',
          isPublic && 'mx-auto max-w-md'
        )}
      >
        {children}
      </div>
    </div>
  )
}
