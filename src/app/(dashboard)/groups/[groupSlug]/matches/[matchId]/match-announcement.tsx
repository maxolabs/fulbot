'use client'

import { useState } from 'react'
import { Copy, Check, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  const [copied, setCopied] = useState(false)
  const text = buildAnnouncementText(input)
  const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const content = (
    <div className="space-y-3">
      <div className="space-y-1">
        <Eyebrow as="h2">Anuncio del partido</Eyebrow>
        <p className="text-sm text-muted-foreground">Copiá o compartí este texto en el grupo de WhatsApp</p>
      </div>

      <pre className="whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2.5 font-sans text-sm">
        {text}
      </pre>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={handleCopy} aria-live="polite">
          {copied ? (
            <Check className="h-4 w-4 text-success" strokeWidth={2} aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          )}
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={waUrl} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Compartir por WhatsApp
          </a>
        </Button>
      </div>
    </div>
  )

  if (variant === 'bare') return content

  return (
    <Card variant="solid">
      <CardContent className="p-4 lg:p-5">{content}</CardContent>
    </Card>
  )
}
