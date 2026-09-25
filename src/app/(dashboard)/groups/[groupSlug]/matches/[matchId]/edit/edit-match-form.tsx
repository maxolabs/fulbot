'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CircleAlert } from 'lucide-react'
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
    durationMinutes: number
    resultsRequestDelayMinutes: number
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
  const [durationMinutes, setDurationMinutes] = useState(defaults.durationMinutes)
  const [resultsRequestDelayMinutes, setResultsRequestDelayMinutes] = useState(defaults.resultsRequestDelayMinutes)

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
          duration_minutes: durationMinutes,
          results_request_delay_minutes: resultsRequestDelayMinutes,
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
        <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="date">{t('matches.date')}</Label>
          <Input
            id="date"
            type="date"
            className="font-mono tabular-nums"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="time">{t('matches.time')}</Label>
          <Input
            id="time"
            type="time"
            className="font-mono tabular-nums"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
            disabled={loading}
          />
        </div>
      </div>

      <div className="space-y-1.5">
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

      <div className="space-y-1.5">
        <Label htmlFor="maxPlayers">{t('matches.maxPlayers')}</Label>
        <Input
          id="maxPlayers"
          type="number"
          className="font-mono tabular-nums"
          min={4}
          max={30}
          value={maxPlayers}
          onChange={(e) => setMaxPlayers(Number(e.target.value))}
          required
          disabled={loading}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="durationMinutes">Duración (min)</Label>
          <Input
            id="durationMinutes"
            type="number"
          className="font-mono tabular-nums"
            min={10}
            max={300}
            step={5}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
            required
            disabled={loading}
          />
          <p className="text-xs text-muted-foreground">
            Al pasar este tiempo el partido se da por terminado solo
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="resultsRequestDelayMinutes">Pedir el resultado (min después del final)</Label>
          <Input
            id="resultsRequestDelayMinutes"
            type="number"
          className="font-mono tabular-nums"
            min={0}
            max={1440}
            step={5}
            value={resultsRequestDelayMinutes}
            onChange={(e) => setResultsRequestDelayMinutes(Number(e.target.value))}
            required
            disabled={loading}
          />
          <p className="text-xs text-muted-foreground">
            Cuándo se les pide a los jugadores que carguen el resultado
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
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

      <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row">
        <Button type="submit" disabled={loading} className="w-full sm:w-auto">
          {loading && <Spinner size="sm" className="mr-2" />}
          {t('common.save')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={loading}
          className="w-full sm:w-auto"
        >
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
