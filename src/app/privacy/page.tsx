import type { Metadata } from 'next'
import { LegalDocument } from '@/components/legal-document'
import { getT } from '@/i18n/server'
import { publicLanguage } from '@/lib/legal-language'

// Privacy policy (OD-5). Draft text for the owner to review; it describes
// what the app stores and sends today (00033, src/lib/ai/team-generator.ts).

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(await publicLanguage())
  return { title: t('ui.legal.privacy.title') }
}

export default async function PrivacyPage() {
  const t = getT(await publicLanguage())
  const k = 'ui.legal.privacy.'

  return (
    <LegalDocument
      t={t}
      current="privacy"
      title={t(`${k}title`)}
      intro={t(`${k}intro`)}
      sections={[
        {
          title: t(`${k}dataTitle`),
          items: [
            t(`${k}dataAccount`),
            t(`${k}dataProfile`),
            t(`${k}dataMatches`),
            t(`${k}dataRatings`),
            t(`${k}dataScore`),
            t(`${k}dataPush`),
            t(`${k}dataGuests`),
          ],
        },
        { title: t(`${k}useTitle`), paragraphs: [t(`${k}useBody`)] },
        {
          title: t(`${k}whoTitle`),
          items: [
            t(`${k}whoMembers`),
            t(`${k}whoEmail`),
            t(`${k}whoRatings`),
            t(`${k}whoScore`),
            t(`${k}whoLink`),
          ],
        },
        {
          title: t(`${k}processorsTitle`),
          items: [
            t(`${k}processorsSupabase`),
            t(`${k}processorsVercel`),
            t(`${k}processorsOpenai`),
            t(`${k}processorsPush`),
            t(`${k}processorsWhatsapp`),
          ],
        },
        { title: t(`${k}cookiesTitle`), paragraphs: [t(`${k}cookiesBody`)] },
        { title: t(`${k}retentionTitle`), paragraphs: [t(`${k}retentionBody`)] },
        { title: t(`${k}deleteTitle`), paragraphs: [t(`${k}deleteBody`)] },
        { title: t(`${k}changesTitle`), paragraphs: [t(`${k}changesBody`)] },
      ]}
    />
  )
}
