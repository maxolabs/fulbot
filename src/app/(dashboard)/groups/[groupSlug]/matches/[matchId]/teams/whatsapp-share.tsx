'use client'

import { useState, useRef, useEffect } from 'react'
import { Copy, Check, MessageCircle, Image, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

interface Player {
  id: string
  displayName: string
  nickname: string | null
  mainPosition: string
  overallRating: number
  position: string
}

interface WhatsAppShareProps {
  matchDate: Date
  darkPlayers: Player[]
  lightPlayers: Player[]
  groupName: string
}

type MessageFormat = 'simple' | 'detailed' | 'emoji'

function Dropdown({
  trigger,
  items,
}: {
  trigger: React.ReactNode
  items: { label: string; onClick: () => void }[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative" ref={dropdownRef}>
      <div onClick={() => setIsOpen(!isOpen)}>{trigger}</div>
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 min-w-[160px] rounded-md border bg-white shadow-lg z-50">
          {items.map((item, i) => (
            <button
              key={i}
              onClick={() => {
                item.onClick()
                setIsOpen(false)
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 first:rounded-t-md last:rounded-b-md"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function WhatsAppShare({
  matchDate,
  darkPlayers,
  lightPlayers,
  groupName,
}: WhatsAppShareProps) {
  const [copied, setCopied] = useState(false)
  const [downloadingImage, setDownloadingImage] = useState(false)

  const formatPlayerName = (player: Player) => {
    return player.nickname || player.displayName.split(' ')[0]
  }

  const formatDate = (date: Date) => {
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
    const day = days[date.getDay()]
    const dateStr = date.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })
    const time = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    return `${day} ${dateStr} - ${time}`
  }

  const generateMessage = (format: MessageFormat): string => {
    const dateStr = formatDate(matchDate)

    if (format === 'simple') {
      const darkNames = darkPlayers.map(p => formatPlayerName(p)).join(', ')
      const lightNames = lightPlayers.map(p => formatPlayerName(p)).join(', ')

      return `*${groupName}*
${dateStr}

*Equipo Oscuro:* ${darkNames}

*Equipo Claro:* ${lightNames}`
    }

    if (format === 'detailed') {
      const darkList = darkPlayers
        .map(p => `  ${p.position} - ${formatPlayerName(p)}`)
        .join('\n')
      const lightList = lightPlayers
        .map(p => `  ${p.position} - ${formatPlayerName(p)}`)
        .join('\n')

      return `*${groupName}*
${dateStr}

*EQUIPO OSCURO* (${darkPlayers.length})
${darkList}

*EQUIPO CLARO* (${lightPlayers.length})
${lightList}`
    }

    // Emoji format
    const darkList = darkPlayers
      .map(p => `⚫ ${formatPlayerName(p)} (${p.position})`)
      .join('\n')
    const lightList = lightPlayers
      .map(p => `⚪ ${formatPlayerName(p)} (${p.position})`)
      .join('\n')

    return `⚽ *${groupName}* ⚽
📅 ${dateStr}

🖤 *EQUIPO OSCURO*
${darkList}

🤍 *EQUIPO CLARO*
${lightList}

¡Nos vemos en la cancha! 🏟️`
  }

  const copyToClipboard = async (format: MessageFormat) => {
    const message = generateMessage(format)
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const shareViaWhatsApp = (format: MessageFormat) => {
    const message = generateMessage(format)
    const encoded = encodeURIComponent(message)
    window.open(`https://wa.me/?text=${encoded}`, '_blank')
  }

  const downloadLineupImage = async () => {
    setDownloadingImage(true)
    try {
      const data = {
        groupName,
        matchDate: formatDate(matchDate),
        darkTeam: darkPlayers.map(p => ({
          name: formatPlayerName(p),
          position: p.position,
          rating: p.overallRating,
        })),
        lightTeam: lightPlayers.map(p => ({
          name: formatPlayerName(p),
          position: p.position,
          rating: p.overallRating,
        })),
      }

      const params = new URLSearchParams({
        data: encodeURIComponent(JSON.stringify(data)),
      })

      const response = await fetch(`/api/export/lineup-image?${params}`)
      if (!response.ok) throw new Error('Failed to generate image')

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `equipos-${groupName.toLowerCase().replace(/\s+/g, '-')}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to download image:', err)
    } finally {
      setDownloadingImage(false)
    }
  }

  if (darkPlayers.length === 0 && lightPlayers.length === 0) {
    return null
  }

  const formatOptions = [
    { label: 'Formato simple', format: 'simple' as MessageFormat },
    { label: 'Con posiciones', format: 'detailed' as MessageFormat },
    { label: 'Con emojis', format: 'emoji' as MessageFormat },
  ]

  return (
    <div className="flex items-center gap-2">
      <Dropdown
        trigger={
          <Button variant="outline" size="sm">
            {copied ? (
              <Check className="mr-2 h-4 w-4 text-green-600" />
            ) : (
              <Copy className="mr-2 h-4 w-4" />
            )}
            Copiar
          </Button>
        }
        items={formatOptions.map(opt => ({
          label: opt.label,
          onClick: () => copyToClipboard(opt.format),
        }))}
      />

      <Dropdown
        trigger={
          <Button variant="outline" size="sm" className="bg-green-50 hover:bg-green-100 border-green-200">
            <MessageCircle className="mr-2 h-4 w-4 text-green-600" />
            WhatsApp
          </Button>
        }
        items={formatOptions.map(opt => ({
          label: opt.label,
          onClick: () => shareViaWhatsApp(opt.format),
        }))}
      />

      <Button
        variant="outline"
        size="sm"
        onClick={downloadLineupImage}
        disabled={downloadingImage}
        className="bg-blue-50 hover:bg-blue-100 border-blue-200"
      >
        {downloadingImage ? (
          <Spinner size="sm" className="mr-2" />
        ) : (
          <Download className="mr-2 h-4 w-4 text-blue-600" />
        )}
        Imagen
      </Button>
    </div>
  )
}
