import * as React from 'react'
import { cn } from '@/lib/utils/cn'

// The mono uppercase label (docs/ui-rework/04-components.md §2). Sits above
// hero blocks, list groups and sections. Server-safe: no hooks, no client
// directive.
export type EyebrowElement = 'p' | 'span' | 'div' | 'h2' | 'h3' | 'h4' | 'label'

export interface EyebrowProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode
  as?: EyebrowElement
}

export const eyebrowClassName =
  'font-mono text-[10px] font-medium uppercase leading-none tracking-[.12em] text-muted-foreground'

export function Eyebrow({ children, as = 'p', className, ...props }: EyebrowProps) {
  const Tag = as
  return (
    <Tag className={cn(eyebrowClassName, className)} {...props}>
      {children}
    </Tag>
  )
}
