'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Download, MessageCircle, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/provider'

export function ShareActions({ text, file }: { text: string; file?: File | null }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  // Unknown until mounted; offer the share sheet only where files can be shared.
  const [canShareFile, setCanShareFile] = useState<boolean | null>(null)
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timeout.current), [])
  useEffect(() => {
    setCanShareFile(file ? Boolean(navigator.canShare?.({ files: [file] })) : null)
  }, [file])

  async function copy() {
    setError(null)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      clearTimeout(timeout.current)
      timeout.current = setTimeout(() => setCopied(false), 2000)
    } catch { setError(t('sharing.copyError')) }
  }

  function download() {
    if (!file) return
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function shareImage() {
    if (!file) return
    setError(null)
    // The file is already prepared before this tap, preserving iOS activation.
    if (!navigator.canShare?.({ files: [file] })) {
      setError(t('sharing.imageFallback'))
      return
    }
    setSharing(true)
    try { await navigator.share({ files: [file], text }) }
    catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) setError(t('sharing.shareError'))
    } finally { setSharing(false) }
  }

  return (
    <div className="space-y-3">
      {file && canShareFile !== false && (
        <Button type="button" className="w-full" onClick={shareImage} disabled={sharing}>
          <Share2 className="h-4 w-4" aria-hidden="true" />{t('sharing.shareImage')}
        </Button>
      )}
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="grow">
          <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="h-4 w-4" aria-hidden="true" />{t(file ? 'sharing.whatsappText' : 'sharing.whatsapp')}
          </a>
        </Button>
        <Button type="button" variant="outline" onClick={copy}>
          {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {t(copied ? 'sharing.copied' : 'sharing.copy')}
        </Button>
        {/* Without a share sheet, saving the image is the main action. */}
        {file && <Button type="button" variant={canShareFile === false ? 'default' : 'outline'} className={canShareFile === false ? 'order-first w-full' : undefined} onClick={download}><Download className="h-4 w-4" aria-hidden="true" />{t('sharing.download')}</Button>}
      </div>
      <p className="text-xs text-muted-foreground">{t(file ? 'sharing.imageHint' : 'sharing.hint')}</p>
      <span role="status" className="sr-only">{copied ? t('sharing.copied') : ''}</span>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
