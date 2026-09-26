import Link from 'next/link'
import { cookies } from 'next/headers'
import { PublicFrame } from '@/components/layout/public-frame'
import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/ui/eyebrow'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'

// Every notFound() in the app lands here (non-members on a group, a deleted
// match, a mistyped URL). On the board, with one way out: /groups, which
// sends a signed-out visitor to login first.
export default async function NotFound() {
  const cookieStore = await cookies()
  const language: Language = cookieStore.get('fulbot_lang')?.value === 'en' ? 'en' : 'es'
  const t = getT(language)

  return (
    <PublicFrame width="sm" className="justify-center">
      <div className="space-y-4 text-center">
        <Eyebrow>404</Eyebrow>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-balance">
          {t('ui.errors.notFoundTitle')}
        </h1>
        <p className="text-sm text-muted-foreground text-pretty">{t('ui.errors.notFoundBody')}</p>
        <div className="pt-2">
          <Button asChild>
            <Link href="/groups">{t('ui.errors.goToGroups')}</Link>
          </Button>
        </div>
      </div>
    </PublicFrame>
  )
}
