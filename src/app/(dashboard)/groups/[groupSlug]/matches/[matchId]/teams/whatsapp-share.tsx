'use client'

import { useState } from 'react'
import { Check, CircleAlert, Copy, Download, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { Segmented } from '@/components/ui/segmented'
import { Spinner } from '@/components/ui/spinner'
import { useLanguage, useT } from '@/i18n/provider'

// "Enviar al grupo" (docs/ui-rework/03-screens.md §4): a sheet with the
// message format and three ways out — WhatsApp, the clipboard, the lineup
// image from /api/export/lineup-image (01-brand.md §6). The share text is
// unchanged from before the rework; only the container is new.

export interface SharePlayer {
  id: string
  displayName: string
  nickname: string | null
  position: string
}

export type MessageFormat = 'simple' | 'detailed' | 'emoji'

export interface ShareInput {
  groupName: string
  /** Pre-formatted in the group's timezone, e.g. "Lunes 14/9 - 20:00". */
  dateLabel: string
  darkPlayers: SharePlayer[]
  lightPlayers: SharePlayer[]
}

export function shareName(player: SharePlayer): string {
  return player.nickname || player.displayName.split(' ')[0]
}

export function generateShareMessage(format: MessageFormat, input: ShareInput): string {
  const { groupName, dateLabel: dateStr, darkPlayers, lightPlayers } = input

  if (format === 'simple') {
    const darkNames = darkPlayers.map(shareName).join(', ')
    const lightNames = lightPlayers.map(shareName).join(', ')

    return `*${groupName}*
${dateStr}

*Equipo Oscuro:* ${darkNames}

*Equipo Claro:* ${lightNames}`
  }

  if (format === 'detailed') {
    const darkList = darkPlayers.map((p) => `  ${p.position} - ${shareName(p)}`).join('\n')
    const lightList = lightPlayers.map((p) => `  ${p.position} - ${shareName(p)}`).join('\n')

    return `*${groupName}*
${dateStr}

*EQUIPO OSCURO* (${darkPlayers.length})
${darkList}

*EQUIPO CLARO* (${lightPlayers.length})
${lightList}`
  }

  const darkList = darkPlayers.map((p) => `⚫ ${shareName(p)} (${p.position})`).join('\n')
  const lightList = lightPlayers.map((p) => `⚪ ${shareName(p)} (${p.position})`).join('\n')

  return `⚽ *${groupName}* ⚽
📅 ${dateStr}

🖤 *EQUIPO OSCURO*
${darkList}

🤍 *EQUIPO CLARO*
${lightList}

¡Nos vemos en la cancha! 🏟️`
}

export interface WhatsAppShareProps extends ShareInput {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WhatsAppShare({ open, onOpenChange, ...input }: WhatsAppShareProps) {
  const t = useT()
  const language = useLanguage()
  const [format, setFormat] = useState<MessageFormat>('simple')
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const message = generateShareMessage(format, input)

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const shareViaWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank')
  }

  const downloadLineupImage = async () => {
    setDownloading(true)
    setError(null)
    try {
      // No scores here: the image is shared with the whole group and ratings are
      // visible to admins and captains only.
      const data = {
        groupName: input.groupName,
        matchDate: input.dateLabel,
        lang: language,
        darkTeam: input.darkPlayers.map((p) => ({ name: shareName(p), position: p.position })),
        lightTeam: input.lightPlayers.map((p) => ({ name: shareName(p), position: p.position })),
      }
      const params = new URLSearchParams({ data: encodeURIComponent(JSON.stringify(data)) })
      const response = await fetch(`/api/export/lineup-image?${params}`)
      if (!response.ok) throw new Error('Failed to generate image')

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `equipos-${input.groupName.toLowerCase().replace(/\s+/g, '-')}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to download image:', err)
      setError(t('ui.teamsScreen.imageError'))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('ui.teamsScreen.shareTitle')}
      description={t('ui.teamsScreen.shareDescription')}
    >
      <div className="space-y-4">
        <Segmented
          aria-label={t('ui.teamsScreen.shareDescription')}
          value={format}
          onChange={setFormat}
          options={[
            { value: 'simple', label: t('ui.teamsScreen.formatSimple') },
            { value: 'detailed', label: t('ui.teamsScreen.formatDetailed') },
            { value: 'emoji', label: t('ui.teamsScreen.formatEmoji') },
          ]}
        />

        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 font-sans text-sm text-foreground">
          {message}
        </pre>

        {error && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <CircleAlert className="h-4 w-4" strokeWidth={1.75} />
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <Button type="button" size="xl" onClick={shareViaWhatsApp}>
            <MessageCircle className="h-4 w-4" strokeWidth={1.75} />
            {t('ui.teamsScreen.openWhatsApp')}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={copyToClipboard}>
              {copied ? (
                <Check className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <Copy className="h-4 w-4" strokeWidth={1.75} />
              )}
              {copied ? t('ui.teamsScreen.copied') : t('ui.teamsScreen.copyText')}
            </Button>
            <Button type="button" variant="outline" onClick={downloadLineupImage} disabled={downloading}>
              {downloading ? <Spinner size="sm" /> : <Download className="h-4 w-4" strokeWidth={1.75} />}
              {t('ui.teamsScreen.downloadImage')}
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
