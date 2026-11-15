import Link from 'next/link'
import { PublicFrame } from '@/components/layout/public-frame'
import { Eyebrow } from '@/components/ui/eyebrow'
import type { TranslateFn } from '@/i18n/core'

// /privacy and /terms (OD-5): a public page on the board (PublicFrame), one
// readable column, sections separated by solid rules. Text comes from
// ui.legal.* so both languages share the layout.

export interface LegalSection {
  title: string
  paragraphs?: string[]
  items?: string[]
}

interface LegalDocumentProps {
  t: TranslateFn
  title: string
  intro: string
  sections: LegalSection[]
  current: 'privacy' | 'terms'
}

const linkClassName =
  'rounded-[3px] font-medium text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

export function LegalDocument({ t, title, intro, sections, current }: LegalDocumentProps) {
  return (
    <PublicFrame className="max-w-2xl">
      <article className="w-full space-y-8 pb-12">
        <header className="space-y-3">
          <Eyebrow>{t('ui.legal.eyebrow')}</Eyebrow>
          <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tight text-balance lg:text-4xl">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">{t('ui.legal.updated', { date: t('ui.legal.date') })}</p>
          <p className="text-sm leading-relaxed text-pretty">{intro}</p>
        </header>

        {sections.map((section) => (
          <section key={section.title} className="space-y-3 border-t border-border pt-6">
            <h2 className="text-base font-semibold text-balance">{section.title}</h2>
            {section.paragraphs?.map((p) => (
              <p key={p} className="text-sm leading-relaxed text-pretty">{p}</p>
            ))}
            {section.items && (
              <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed marker:text-muted-foreground">
                {section.items.map((item) => (
                  <li key={item} className="text-pretty">{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <nav
          aria-label={t('ui.legal.eyebrow')}
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-6 text-sm"
        >
          {current === 'privacy' ? (
            <Link href="/terms" className={linkClassName}>{t('ui.legal.terms.title')}</Link>
          ) : (
            <Link href="/privacy" className={linkClassName}>{t('ui.legal.privacy.title')}</Link>
          )}
          <Link href="/" className={linkClassName}>{t('ui.legal.backHome')}</Link>
        </nav>
      </article>
    </PublicFrame>
  )
}
