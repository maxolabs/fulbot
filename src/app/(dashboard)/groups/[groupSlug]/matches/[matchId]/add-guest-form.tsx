'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Link2, MessageCircle, Star, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_TIMEZONE, formatMatchDateShort, formatMatchTime } from '@/lib/utils/datetime'
import type { Database } from '@/types/database'

interface AddGuestFormProps {
  matchId: string
  isFull: boolean
  maxPlayers: number
  confirmedCount: number
  groupName: string
  dateTime: string
  location: string | null
  timeZone?: string
}

type Mode = 'closed' | 'link' | 'manual'

const RATING_VALUES = [1, 2, 3, 4, 5] as const
const DEFAULT_RATING = 3

const POSITIONS = [
  { value: '', label: 'Sin definir' },
  { value: 'GK', label: 'Arquero (GK)' },
  { value: 'CB', label: 'Defensor central (CB)' },
  { value: 'LB', label: 'Lateral izquierdo (LB)' },
  { value: 'RB', label: 'Lateral derecho (RB)' },
  { value: 'CDM', label: 'Mediocampista defensivo (CDM)' },
  { value: 'CM', label: 'Mediocampista central (CM)' },
  { value: 'CAM', label: 'Mediocampista ofensivo (CAM)' },
  { value: 'LW', label: 'Extremo izquierdo (LW)' },
  { value: 'RW', label: 'Extremo derecho (RW)' },
  { value: 'ST', label: 'Delantero (ST)' },
]

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

// Personal invite for one guest: same public /m/[matchId] page the group
// announcement points to, but phrased for a single person. Zone-aware
// formatters keep the text identical on server and client.
export function buildGuestInviteText({
  groupName,
  dateTime,
  location,
  matchId,
  timeZone = DEFAULT_TIMEZONE,
}: Pick<AddGuestFormProps, 'groupName' | 'dateTime' | 'location' | 'matchId' | 'timeZone'>) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const signupUrl = `${appUrl}/m/${matchId}`
  const when = `${formatMatchDateShort(dateTime, timeZone)} a las ${formatMatchTime(dateTime, timeZone)}`

  return (
    `⚽ ¡Hola! Te invito a jugar con ${groupName} el ${when}` +
    (location ? ` en ${location}` : '') +
    `.\n👉 Anotate con tu nombre acá: ${signupUrl}`
  )
}

// Admin/captain panel to bring an outside player into the match. Two paths:
// send them a personal invite link (they sign themselves up on the public
// page, no account needed) or add them by hand right now, optionally with a
// short description, a 1-5 level and a position so the team balancer weighs
// them properly instead of using the guest defaults.
export function AddGuestForm({
  matchId,
  isFull,
  maxPlayers,
  confirmedCount,
  groupName,
  dateTime,
  location,
  timeZone = DEFAULT_TIMEZONE,
}: AddGuestFormProps) {
  const router = useRouter()
  const supabase = createClient()
  const [mode, setMode] = useState<Mode>('closed')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [rating, setRating] = useState<number>(DEFAULT_RATING)
  const [position, setPosition] = useState('')
  const [error, setError] = useState<string | null>(null)

  const inviteText = buildGuestInviteText({ groupName, dateTime, location, matchId, timeZone })
  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/m/${matchId}`
  const waUrl = `https://wa.me/?text=${encodeURIComponent(inviteText)}`

  const spotsHint = isFull
    ? 'El partido está completo. Quien se sume irá a lista de espera.'
    : `Quedan ${maxPlayers - confirmedCount} lugares disponibles.`

  const toggle = (next: Mode) => {
    setError(null)
    setMode((current) => (current === next ? 'closed' : next))
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setLoading(true)
    setError(null)

    try {
      const args: Database['public']['Functions']['admin_add_guest_signup']['Args'] = {
        p_match_id: matchId,
        p_display_name: name.trim(),
        p_notes: notes.trim() || undefined,
        p_estimated_rating: rating,
        p_preferred_positions: position ? [position] : undefined,
      }
      const { error: signupError } = await supabase.rpc('admin_add_guest_signup', args)

      if (signupError) throw signupError

      setName('')
      setNotes('')
      setRating(DEFAULT_RATING)
      setPosition('')
      setMode('closed')
      router.refresh()
    } catch (err) {
      console.error('Error adding guest:', err)
      setError('Error al agregar invitado')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sumar un invitado</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2">
          <Button
            type="button"
            variant={mode === 'link' ? 'secondary' : 'outline'}
            className="w-full justify-start"
            onClick={() => toggle('link')}
          >
            <Link2 className="mr-2 h-4 w-4" />
            Mandar link de invitación
          </Button>
          <Button
            type="button"
            variant={mode === 'manual' ? 'secondary' : 'outline'}
            className="w-full justify-start"
            onClick={() => toggle('manual')}
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Agregar a mano
          </Button>
        </div>

        {mode === 'link' && (
          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">
              El invitado se anota solo con su nombre, sin crear cuenta. {spotsHint}
            </p>
            <pre className="whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2.5 text-sm font-sans">
              {inviteText}
            </pre>
            <p className="text-xs text-muted-foreground break-all">{inviteUrl}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                {copied ? 'Copiado' : 'Copiar'}
              </Button>
              <a href={waUrl} target="_blank" rel="noopener noreferrer">
                <Button type="button" size="sm">
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Mandar por WhatsApp
                </Button>
              </a>
            </div>
          </div>
        )}

        {mode === 'manual' && (
          <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border p-3">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="guest-name">Nombre *</Label>
              <Input
                id="guest-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre del invitado"
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="guest-notes">Descripción</Label>
              <Input
                id="guest-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej: amigo de Juan, juega de delantero"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="guest-rating">Nivel</Label>
              <div id="guest-rating" role="radiogroup" aria-label="Nivel del invitado" className="flex items-center gap-1">
                {RATING_VALUES.map((value) => {
                  const active = value <= rating
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={rating === value}
                      aria-label={`${value} de 5`}
                      onClick={() => setRating(value)}
                      className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Star
                        className={`h-5 w-5 ${active ? 'text-yellow-500 fill-yellow-500' : 'text-muted-foreground'}`}
                      />
                    </button>
                  )
                })}
                <span className="ml-2 text-sm text-muted-foreground">{rating}/5</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="guest-position">Posición</Label>
              <select
                id="guest-position"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                disabled={loading}
                className={SELECT_CLASS}
              >
                {POSITIONS.map((pos) => (
                  <option key={pos.value} value={pos.value}>
                    {pos.label}
                  </option>
                ))}
              </select>
            </div>

            <p className="text-xs text-muted-foreground">{spotsHint}</p>

            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={loading || !name.trim()}>
                {loading && <Spinner size="sm" className="mr-2" />}
                Agregar
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => toggle('manual')}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
