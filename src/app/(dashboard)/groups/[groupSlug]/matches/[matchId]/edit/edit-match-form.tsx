'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import { combineDateTimeInTimezone } from '@/lib/utils/datetime'
import { useT } from '@/i18n/provider'

interface EditMatchFormProps {
  matchId: string
  groupSlug: string
  timezone: string
  defaults: {
    date: string
    time: string
    location: string
    maxPlayers: number
    notes: string
  }
}

export function EditMatchForm({ matchId, groupSlug, timezone, defaults }: EditMatchFormProps) {
  const t = useT()
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [date, setDate] = useState(defaults.date)
  const [time, setTime] = useState(defaults.time)
  const [location, setLocation] = useState(defaults.location)
  const [maxPlayers, setMaxPlayers] = useState(defaults.maxPlayers)
  const [notes, setNotes] = useState(defaults.notes)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const dateTime = combineDateTimeInTimezone(date, time, timezone).toISOString()

      const { error: updateError } = await supabase
        .from('matches')
        .update({
          date_time: dateTime,
          location: location || null,
          max_players: maxPlayers,
          notes: notes || null,
        })
        .eq('id', matchId)

      if (updateError) {
        throw updateError
      }

      router.push(`/groups/${groupSlug}/matches/${matchId}`)
      router.refresh()
    } catch (err) {
      console.error('Error updating match:', err)
      setError(t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="date">{t('matches.date')}</Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="time">{t('matches.time')}</Label>
          <Input
            id="time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
            disabled={loading}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="location">{t('matches.location')}</Label>
        <Input
          id="location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          disabled={loading}
          placeholder="Ej: Cancha del club"
          maxLength={200}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="maxPlayers">{t('matches.maxPlayers')}</Label>
        <Input
          id="maxPlayers"
          type="number"
          min={4}
          max={30}
          value={maxPlayers}
          onChange={(e) => setMaxPlayers(Number(e.target.value))}
          required
          disabled={loading}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">{t('matches.notes')}</Label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={loading}
          placeholder="Ej: Traer pechera"
          maxLength={500}
          rows={2}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={loading}>
          {loading && <Spinner size="sm" className="mr-2" />}
          {t('common.save')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={loading}
        >
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
