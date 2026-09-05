'use client'

import { useState } from 'react'
import { Megaphone, Copy, Check, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DEFAULT_TIMEZONE, formatMatchDateShort, formatMatchTime } from '@/lib/utils/datetime'

interface MatchAnnouncementProps {
  groupName: string
  dateTime: string
  location: string | null
  confirmedCount: number
  maxPlayers: number
  matchId: string
  timeZone?: string
}

// Builds the Spanish WhatsApp-ready announcement text for a match (see
// docs/rework-plan.md §2.4) and offers Copy + wa.me share actions. Uses the
// zone-aware formatters (with an explicit timeZone) so this renders
// identically on the server and after hydration in the browser -- no
// dependency on the runtime's local timezone or locale-default AM/PM.
export function buildAnnouncementText({
  groupName,
  dateTime,
  location,
  confirmedCount,
  maxPlayers,
  matchId,
  timeZone = DEFAULT_TIMEZONE,
}: MatchAnnouncementProps) {
  const dayLabel = formatMatchDateShort(dateTime, timeZone)
  const timeLabel = formatMatchTime(dateTime, timeZone)
  const spotsLeft = Math.max(0, maxPlayers - confirmedCount)
  const spotsLabel = spotsLeft > 0 ? `faltan ${spotsLeft} lugares` : 'no quedan lugares'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const signupUrl = `${appUrl}/m/${matchId}`

  return (
    `⚽ ${groupName} — ${dayLabel} ${timeLabel}\n` +
    (location ? `📍 ${location}\n` : '') +
    `👥 ${confirmedCount}/${maxPlayers} anotados — ${spotsLabel}\n` +
    `👉 Anotate acá: ${signupUrl}\n` +
    `Remera oscura/clara según tu equipo.`
  )
}

export function MatchAnnouncement(props: MatchAnnouncementProps) {
  const [copied, setCopied] = useState(false)
  const text = buildAnnouncementText(props)
  const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center gap-3">
          <Megaphone className="h-5 w-5 text-muted-foreground shrink-0" />
          <div>
            <p className="font-medium">Anuncio del partido</p>
            <p className="text-sm text-muted-foreground">
              Copiá o compartí este texto en el grupo de WhatsApp
            </p>
          </div>
        </div>

        <pre className="whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2.5 text-sm font-sans">
          {text}
        </pre>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
          <a href={waUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="default" size="sm">
              <MessageCircle className="mr-2 h-4 w-4" />
              Compartir por WhatsApp
            </Button>
          </a>
        </div>
      </CardContent>
    </Card>
  )
}
