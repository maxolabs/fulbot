'use client'

import { useT } from '@/i18n/provider'

export function SkipLink() {
  const t = useT()
  return (
    <a
      href="#main-content"
      className="sr-only fixed left-4 top-4 z-50 rounded-md bg-primary font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:px-4 focus:py-3"
    >
      {t('ui.shell.skipToContent')}
    </a>
  )
}
