import { cookies } from 'next/headers'
import { Users, Brain, BarChart3 } from 'lucide-react'
import { PublicFrame } from '@/components/layout/public-frame'
import { Card, CardContent } from '@/components/ui/card'
import { LinkButton } from '@/components/link-button'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'

// Landing (docs/ui-rework/03-screens.md §11, 06-principles.md §1.5): on the
// board, tagline in the display face, the three feature blocks as three
// dashed cards in a row (stacked on phones), one cone "Crear cuenta" and a
// text "Iniciar sesión".

export default async function Home() {
  const cookieStore = await cookies()
  const langCookie = cookieStore.get('fulbot_lang')?.value
  const language: Language = langCookie === 'en' ? 'en' : 'es'
  const t = getT(language)

  const features = [
    { icon: Users, title: t('landing.featureSignupTitle'), desc: t('landing.featureSignupDesc') },
    { icon: Brain, title: t('landing.featureTeamsTitle'), desc: t('landing.featureTeamsDesc') },
    { icon: BarChart3, title: t('landing.featureStatsTitle'), desc: t('landing.featureStatsDesc') },
  ]

  return (
    <PublicFrame className="max-w-2xl justify-center">
      <div className="w-full space-y-10">
        <h1 className="mx-auto max-w-md text-center font-display text-3xl font-extrabold leading-tight tracking-tight text-balance lg:text-4xl">
          {t('landing.tagline')}
        </h1>

        <ul className="grid gap-3 sm:grid-cols-3">
          {features.map((feature) => (
            <li key={feature.title}>
              <Card className="h-full">
                <CardContent className="flex items-start gap-3 pt-4 sm:flex-col sm:gap-3 lg:pt-5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                    <feature.icon className="h-5 w-5 text-foreground" strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 space-y-1">
                    <span className="block font-display text-base font-bold leading-tight">{feature.title}</span>
                    <span className="block text-sm text-muted-foreground text-pretty">{feature.desc}</span>
                  </span>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>

        <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-3">
          <LinkButton href="/register" size="xl" className="w-full">
            {t('auth.createAccount')}
          </LinkButton>
          <LinkButton href="/login" variant="link">
            {t('auth.login')}
          </LinkButton>
        </div>

        <p className="text-center font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">
          {t('landing.footer')}
        </p>
      </div>
    </PublicFrame>
  )
}
