'use client'

import { useEffect, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { PublicFrame } from '@/components/layout/public-frame'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/i18n/provider'
import { getTranslation, type Language } from '@/i18n/core'

// Shared body of the error boundaries (app/global-error.tsx,
// (dashboard)/error.tsx, m/[matchId]/error.tsx, invite/[code]/error.tsx).
// Lives next to the other public-frame screens; not a route.
//
// One cone action (retry) and a chalk-outline way out to /groups. The digest
// is the server log's reference for the failure: logged here and shown small
// so a player can quote it to the admin.

export interface ErrorScreenProps {
  error: Error & { digest?: string }
  reset?: () => void
  /** Public routes render on the board; the dashboard renders inside the shell. */
  framed?: boolean
}

const noSubscribe = () => () => {}

/** The board pages have no LanguageProvider around their error boundary:
 * read the root layout's <html lang> (set from the fulbot_lang cookie). */
function useDocumentLanguage(fallback: Language): Language {
  return useSyncExternalStore(
    noSubscribe,
    () => {
      const lang = document.documentElement.lang
      return lang === 'en' || lang === 'es' ? lang : fallback
    },
    () => fallback
  )
}

export function ErrorScreen({ error, reset, framed = true }: ErrorScreenProps) {
  const contextLanguage = useLanguage()
  const documentLanguage = useDocumentLanguage(contextLanguage)
  const t = getTranslation(framed ? documentLanguage : contextLanguage)

  useEffect(() => {
    console.error('Unhandled error', error.digest ? `(digest ${error.digest})` : '', error)
  }, [error])

  const content = (
    <div className="space-y-4 text-center">
      <h1 className="font-display text-2xl font-extrabold tracking-tight text-balance">
        {t('ui.errors.errorTitle')}
      </h1>
      <p className="text-sm text-muted-foreground text-pretty">{t('ui.errors.errorBody')}</p>
      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-center">
        {reset && (
          <Button type="button" onClick={() => reset()}>
            {t('ui.errors.retry')}
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href="/groups">{t('ui.errors.goToGroups')}</Link>
        </Button>
      </div>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">
          {t('ui.errors.reference', { digest: error.digest })}
        </p>
      )}
    </div>
  )

  if (!framed) {
    return <div className="mx-auto max-w-md px-4 py-16 lg:px-8">{content}</div>
  }
  return (
    <PublicFrame width="sm" className="justify-center">
      {content}
    </PublicFrame>
  )
}
