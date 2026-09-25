import * as React from 'react'
import { Eyebrow } from '@/components/ui/eyebrow'
import { cn } from '@/lib/utils/cn'

// PageHeader (docs/ui-rework/02-shell.md §1, 04-components.md §3): the
// browser-only header row (`hidden lg:flex`). Optional eyebrow, the title in
// the display face, an optional subtitle line and an actions slot on the
// right. On mobile the page renders its own hero block from the same data
// and the top bar carries the title, so this renders nothing there.
//
//   <PageHeader eyebrow="Grupo" title={group.name} subtitle="Lunes 20:00 · …"
//     actions={<Button>Crear partido</Button>} />

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  eyebrow?: React.ReactNode
}

export function PageHeader({ title, subtitle, actions, eyebrow, className, ...props }: PageHeaderProps) {
  return (
    <div
      className={cn('hidden flex-wrap items-start justify-between gap-x-6 gap-y-4 border-b border-border pb-6 lg:flex', className)}
      {...props}
    >
      <div className="min-w-0 flex-1 basis-56 space-y-2">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="break-words font-display text-2xl font-extrabold tracking-tight text-balance lg:text-3xl">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
