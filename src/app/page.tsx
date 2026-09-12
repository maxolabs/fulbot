import Link from 'next/link'
import { cookies } from 'next/headers'
import { Users, Brain, BarChart3, ChevronRight } from 'lucide-react'
import { PublicFrame } from '@/components/layout/public-frame'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'

export default async function Home() {
  const cookieStore = await cookies()
  const langCookie = cookieStore.get('fulbot_lang')?.value
  const language: Language = langCookie === 'en' ? 'en' : 'es'
  const t = getT(language)

  return (
    <PublicFrame className="justify-center">
      <div className="w-full space-y-12">
        {/* Tagline */}
        <div className="text-center">
          <p className="mx-auto max-w-xs text-lg text-muted-foreground">
            {t('landing.tagline')}
          </p>
        </div>

        {/* Features */}
        <div className="space-y-3">
          {[
            {
              icon: Users,
              title: t('landing.featureSignupTitle'),
              desc: t('landing.featureSignupDesc'),
            },
            {
              icon: Brain,
              title: t('landing.featureTeamsTitle'),
              desc: t('landing.featureTeamsDesc'),
            },
            {
              icon: BarChart3,
              title: t('landing.featureStatsTitle'),
              desc: t('landing.featureStatsDesc'),
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="group flex items-center gap-4 rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm p-4 transition-colors hover:border-primary/30 hover:bg-card"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <feature.icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{feature.title}</p>
                <p className="text-sm text-muted-foreground">{feature.desc}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
            </div>
          ))}
        </div>

        {/* CTA Buttons */}
        <div className="space-y-3">
          <Link
            href="/register"
            className="flex items-center justify-center rounded-2xl bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground transition-all hover:brightness-110"
          >
            {t('auth.createAccount')}
          </Link>
          <Link
            href="/login"
            className="flex items-center justify-center rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm px-6 py-3.5 text-sm font-medium text-foreground transition-colors hover:bg-card hover:border-border"
          >
            {t('auth.login')}
          </Link>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground/60">
          {t('landing.footer')}
        </p>
      </div>
    </PublicFrame>
  )
}
