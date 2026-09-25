'use client'

import { useEffect, useRef, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { ShareActions } from '@/components/share-actions'
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
  matchUrl?: string
  /** Pre-formatted in the group's timezone, e.g. "Lunes 14/9 - 20:00". */
  dateLabel: string
  darkPlayers: SharePlayer[]
  lightPlayers: SharePlayer[]
  /** Localized copy; defaults to Spanish for callers without i18n. */
  copy?: ShareCopy
}

export interface ShareCopy { dark: string; light: string; closing: string }
const DEFAULT_COPY: ShareCopy = { dark: 'Equipo Oscuro', light: 'Equipo Claro', closing: '¡Nos vemos en la cancha!' }

export function shareName(player: SharePlayer): string {
  return player.nickname || player.displayName.split(' ')[0]
}

export function generateShareMessage(format: MessageFormat, input: ShareInput): string {
  const link = input.matchUrl ? `\n\n${input.matchUrl}` : ''
  const { groupName, dateLabel: dateStr, darkPlayers, lightPlayers, copy = DEFAULT_COPY } = input

  if (format === 'simple') {
    const darkNames = darkPlayers.map(shareName).join(', ')
    const lightNames = lightPlayers.map(shareName).join(', ')

    return `*${groupName}*
${dateStr}

*${copy.dark}:* ${darkNames}

*${copy.light}:* ${lightNames}${link}`
  }

  if (format === 'detailed') {
    const darkList = darkPlayers.map((p) => `  ${p.position} - ${shareName(p)}`).join('\n')
    const lightList = lightPlayers.map((p) => `  ${p.position} - ${shareName(p)}`).join('\n')

    return `*${groupName}*
${dateStr}

*${copy.dark.toUpperCase()}* (${darkPlayers.length})
${darkList}

*${copy.light.toUpperCase()}* (${lightPlayers.length})
${lightList}${link}`
  }

  const darkList = darkPlayers.map((p) => `⚫ ${shareName(p)} (${p.position})`).join('\n')
  const lightList = lightPlayers.map((p) => `⚪ ${shareName(p)} (${p.position})`).join('\n')

  return `⚽ *${groupName}* ⚽
📅 ${dateStr}

🖤 *${copy.dark.toUpperCase()}*
${darkList}

🤍 *${copy.light.toUpperCase()}*
${lightList}

${copy.closing} 🏟️${link}`
}

export interface WhatsAppShareProps extends ShareInput {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WhatsAppShare({ open, onOpenChange, ...input }: WhatsAppShareProps) {
  const t = useT()
  const language = useLanguage()
  const [format, setFormat] = useState<MessageFormat>('simple')
  const [prepared, setPrepared] = useState<{ key: string; file: File } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const message = generateShareMessage(format, input)
  const imageKey = JSON.stringify({
    groupName: input.groupName, matchDate: input.dateLabel, lang: language,
    darkTeam: input.darkPlayers.map((p) => ({ name: shareName(p), position: p.position })),
    lightTeam: input.lightPlayers.map((p) => ({ name: shareName(p), position: p.position })),
  })
  const file = prepared?.key === imageKey ? prepared.file : null
  const error = !file && failure === `${imageKey}:${retry}`
  const preparedKey = useRef<string | null>(null)
  useEffect(() => {
    // Reopening the sheet reuses the image already built for this lineup.
    if (!open || preparedKey.current === imageKey) return
    const controller = new AbortController()
    const params = new URLSearchParams({ data: encodeURIComponent(imageKey) })
    fetch(`/api/export/lineup-image?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Image export failed')
        const blob = await response.blob()
        if (!controller.signal.aborted) {
          preparedKey.current = imageKey
          setPrepared({ key: imageKey, file: new File([blob], 'fulbot-equipos.png', { type: 'image/png' }) })
        }
      })
      .catch(() => { if (!controller.signal.aborted) setFailure(`${imageKey}:${retry}`) })
    return () => controller.abort()
  }, [open, imageKey, retry])

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
          <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
            <CircleAlert className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            {t('ui.teamsScreen.imageError')}
          </p>
        )}

        {!file && !error && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner size="sm" />{t('sharing.preparingImage')}</p>}
        {error && <Button type="button" variant="outline" onClick={() => setRetry((n) => n + 1)}>{t('sharing.retryImage')}</Button>}
        <ShareActions text={message} file={file} />
      </div>
    </Sheet>
  )
}
