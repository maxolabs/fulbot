import type { Metadata } from 'next'
import { LegalDocument } from '@/components/legal-document'
import { getT } from '@/i18n/server'
import { publicLanguage } from '@/lib/legal-language'

// Terms of use (OD-5). Draft text for the owner to review.

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(await publicLanguage())
  return { title: t('ui.legal.terms.title') }
}

export default async function TermsPage() {
  const t = getT(await publicLanguage())
  const k = 'ui.legal.terms.'

  return (
    <LegalDocument
      t={t}
      current="terms"
      title={t(`${k}title`)}
      intro={t(`${k}intro`)}
      sections={[
        { title: t(`${k}whatTitle`), paragraphs: [t(`${k}whatBody`)] },
        { title: t(`${k}accountTitle`), paragraphs: [t(`${k}accountBody`)] },
        { title: t(`${k}groupsTitle`), paragraphs: [t(`${k}groupsBody`)] },
        { title: t(`${k}conductTitle`), paragraphs: [t(`${k}conductBody`)] },
        { title: t(`${k}contentTitle`), paragraphs: [t(`${k}contentBody`)] },
        { title: t(`${k}aiTitle`), paragraphs: [t(`${k}aiBody`)] },
        { title: t(`${k}availabilityTitle`), paragraphs: [t(`${k}availabilityBody`)] },
        { title: t(`${k}endTitle`), paragraphs: [t(`${k}endBody`)] },
        { title: t(`${k}changesTitle`), paragraphs: [t(`${k}changesBody`)] },
      ]}
    />
  )
}
