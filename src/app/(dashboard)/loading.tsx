'use client'

import { useT } from '@/i18n/provider'

export default function DashboardLoading() {
  const t = useT()
  return (
    <div role="status" className="mx-auto max-w-3xl space-y-6">
      <span className="sr-only">{t('common.loading')}</span>
      <div aria-hidden="true" className="animate-pulse space-y-6">
        <div className="space-y-3 border-b border-border pb-6">
          <div className="h-8 w-2/3 rounded-sm bg-muted" />
          <div className="h-4 w-1/2 rounded-sm bg-muted" />
        </div>
        <div className="space-y-4 rounded-md border border-dashed border-border bg-card p-5">
          <div className="h-3 w-24 rounded-sm bg-muted" />
          <div className="h-7 w-3/4 rounded-sm bg-muted" />
          <div className="h-2 w-full rounded-sm bg-muted" />
        </div>
        <div className="divide-y divide-border">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-3 py-4">
              <div className="h-8 w-8 rounded-full bg-muted" />
              <div className="h-4 w-1/2 rounded-sm bg-muted" />
              <div className="ml-auto h-4 w-12 rounded-sm bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
