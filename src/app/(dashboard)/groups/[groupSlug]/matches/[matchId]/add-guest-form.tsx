'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Link2, MessageCircle, Star, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import { getAppBaseUrl } from '@/lib/app-url'
import { DEFAULT_TIMEZONE, formatMatchDateShort, formatMatchTime } from '@/lib/utils/datetime'
import { getTranslation, type Language } from '@/i18n/core'
import { useLanguage, useT } from '@/i18n/provider'
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

// Labels come from positions.* ("Arquero (GK)").
const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST'] as const

// admin_add_guest_signup (00025) raises Spanish text: map it to keys.
function guestErrorKey(err: unknown): string {
  const raw = (err as { message?: unknown } | null)?.message
  const message = typeof raw === 'string' ? raw : ''
  if (message.includes('No tenés permiso')) return 'ui.matchScreens.forms.guest.addForbidden'
  if (message.includes('No se pueden agregar invitados')) return 'ui.matchScreens.forms.guest.addClosed'
  return 'ui.matchScreens.forms.guest.addError'
}

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
  language = 'es',
}: Pick<AddGuestFormProps, 'groupName' | 'dateTime' | 'location' | 'matchId' | 'timeZone'> & { language?: Language }) {
  const t = getTranslation(language)
  const appUrl = getAppBaseUrl()
  const signupUrl = `${appUrl}/m/${matchId}`

  return t('ui.matchScreens.forms.guest.inviteText', {
    group: groupName,
    date: formatMatchDateShort(dateTime, timeZone, language),
    time: formatMatchTime(dateTime, timeZone),
    location: location ? t('ui.matchScreens.forms.guest.inviteLocation', { location }) : '',
    url: signupUrl,
  })
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
  const t = useT()
  const language = useLanguage()
  const router = useRouter()
  const supabase = createClient()
  const [mode, setMode] = useState<Mode>('closed')
  const uid = useId()
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [rating, setRating] = useState<number>(DEFAULT_RATING)
  const [position, setPosition] = useState('')
  const [error, setError] = useState<string | null>(null)

  // The invite goes out in the admin's language (they are the one sending it).
  const inviteText = buildGuestInviteText({ groupName, dateTime, location, matchId, timeZone, language })
  const inviteUrl = `${getAppBaseUrl()}/m/${matchId}`
  const waUrl = `https://wa.me/?text=${encodeURIComponent(inviteText)}`

  const spotsLeft = Math.max(0, maxPlayers - confirmedCount)
  const spotsHint = isFull
    ? t('ui.matchScreens.forms.guest.fullHint')
    : spotsLeft === 1
      ? t('ui.matchScreens.forms.guest.spotsOne')
      : t('ui.matchScreens.forms.guest.spotsMany', { count: spotsLeft })

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
      setError(t(guestErrorKey(err)))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card variant="solid">
      <CardHeader>
        <CardTitle>{t('ui.matchScreens.forms.guest.title')}</CardTitle>
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
            {t('ui.matchScreens.forms.guest.sendLink')}
          </Button>
          <Button
            type="button"
            variant={mode === 'manual' ? 'secondary' : 'outline'}
            className="w-full justify-start"
            onClick={() => toggle('manual')}
          >
            <UserPlus className="mr-2 h-4 w-4" />
            {t('ui.matchScreens.forms.guest.addManually')}
          </Button>
        </div>

        {mode === 'link' && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">
              {t('ui.matchScreens.forms.guest.linkHint')} {spotsHint}
            </p>
            <pre className="whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2.5 text-sm font-sans">
              {inviteText}
            </pre>
            <p className="text-xs text-muted-foreground break-all">{inviteUrl}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                {copied ? t('ui.matchScreens.forms.guest.copied') : t('ui.matchScreens.forms.guest.copy')}
              </Button>
              <a href={waUrl} target="_blank" rel="noopener noreferrer">
                <Button type="button" size="sm">
                  <MessageCircle className="mr-2 h-4 w-4" />
                  {t('ui.matchScreens.forms.guest.sendWhatsapp')}
                </Button>
              </a>
            </div>
          </div>
        )}

        {mode === 'manual' && (
          <form onSubmit={handleSubmit} className="space-y-3 rounded-md border border-border p-3">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor={`${uid}-name`}>{t('ui.matchScreens.forms.guest.name')} *</Label>
              <Input
                id={`${uid}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('ui.matchScreens.forms.guest.namePlaceholder')}
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${uid}-notes`}>{t('ui.matchScreens.forms.guest.description')}</Label>
              <Input
                id={`${uid}-notes`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('ui.matchScreens.forms.guest.descriptionPlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${uid}-rating`}>{t('ui.matchScreens.forms.guest.level')}</Label>
              <div id={`${uid}-rating`} role="radiogroup" aria-label={t('ui.matchScreens.forms.guest.levelLabel')} className="flex items-center gap-1">
                {RATING_VALUES.map((value) => {
                  const active = value <= rating
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={rating === value}
                      aria-label={t('ui.matchScreens.forms.guest.levelOf', { value })}
                      onClick={() => setRating(value)}
                      className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Star
                        className={`h-5 w-5 ${active ? 'fill-primary text-primary' : 'text-muted-foreground'}`}
                      />
                    </button>
                  )
                })}
                <span className="ml-2 text-sm text-muted-foreground">{rating}/5</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${uid}-position`}>{t('ui.matchScreens.forms.guest.position')}</Label>
              <select
                id={`${uid}-position`}
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                disabled={loading}
                className={SELECT_CLASS}
              >
                <option value="">{t('ui.matchScreens.forms.guest.positionNone')}</option>
                {POSITIONS.map((pos) => (
                  <option key={pos} value={pos}>
                    {`${t(`positions.${pos}`)} (${pos})`}
                  </option>
                ))}
              </select>
            </div>

            <p className="text-xs text-muted-foreground">{spotsHint}</p>

            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={loading || !name.trim()}>
                {loading && <Spinner size="sm" className="mr-2" />}
                {t('ui.matchScreens.forms.guest.add')}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => toggle('manual')}>
                {t('ui.matchScreens.forms.cancel')}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
