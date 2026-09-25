'use client'

import { ShareActions } from '@/components/share-actions'
import { Card, CardContent } from '@/components/ui/card'
import { Eyebrow } from '@/components/ui/eyebrow'
import { buildAnnouncementText, type AnnouncementInput } from './announcement-text'

export { buildAnnouncementText } from './announcement-text'

export interface MatchAnnouncementProps extends AnnouncementInput {
  /** `card` (default) for the browser aside; `bare` inside the admin sheet. */
  variant?: 'card' | 'bare'
}

// The WhatsApp-ready announcement with Copy + wa.me share (docs/rework-plan.md
// §2.4). Lives in the aside in the browser and in the "Gestionar" sheet on
// phones (docs/ui-rework/03-screens.md §3). Both buttons are chalk outlines:
// the one orange on the match screen is the signup action.
export function MatchAnnouncement({ variant = 'card', ...input }: MatchAnnouncementProps) {
  const text = buildAnnouncementText(input)

  const content = (
    <div className="space-y-3">
      <div className="space-y-1">
        <Eyebrow as="h2">Anuncio del partido</Eyebrow>
        <p className="text-sm text-muted-foreground">Copiá o compartí este texto en el grupo de WhatsApp</p>
      </div>

      <pre className="whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2.5 font-sans text-sm">
        {text}
      </pre>

      <ShareActions text={text} />
    </div>
  )

  if (variant === 'bare') return content

  return (
    <Card variant="solid">
      <CardContent className="p-4 lg:p-5">{content}</CardContent>
    </Card>
  )
}
