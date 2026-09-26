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

interface CreateMatchFormProps {
  groupId: string
  groupSlug: string
  timezone: string
  defaults: {
    date: string
    time: string
    maxPlayers: number
    durationMinutes: number
    resultsRequestDelayMinutes: number
  }
}

export function CreateMatchForm({ groupId, groupSlug, timezone, defaults }: CreateMatchFormProps) {
  const t = useT()
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [date, setDate] = useState(defaults.date)
  const [time, setTime] = useState(defaults.time)
  const [location, setLocation] = useState('')
  const [maxPlayers, setMaxPlayers] = useState(defaults.maxPlayers)
  const [notes, setNotes] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(defaults.durationMinutes)
  const [resultsRequestDelayMinutes, setResultsRequestDelayMinutes] = useState(defaults.resultsRequestDelayMinutes)
  const [openSignup, setOpenSignup] = useState(true)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Combine date and time into an ISO datetime, honoring the group's timezone
      const dateTime = combineDateTimeInTimezone(date, time, timezone).toISOString()

       
      const { data: match, error: insertError } = await (supabase as any)
        .from('matches')
        .insert({
          group_id: groupId,
          date_time: dateTime,
          location: location || null,
          max_players: maxPlayers,
          notes: notes || null,
          duration_minutes: durationMinutes,
          results_request_delay_minutes: resultsRequestDelayMinutes,
          status: openSignup ? 'signup_open' : 'draft',
        })
        .select('id')
        .single()

      if (insertError) {
        throw insertError
      }

      router.push(`/groups/${groupSlug}/matches/${match.id}`)
      router.refresh()
    } catch (err) {
      console.error('Error creating match:', err)
      // RLS rejects non-admins with 42501 / a row-level security message.
      const e = err as { code?: string; message?: string } | null
      const forbidden = e?.code === '42501' || (e?.message ?? '').includes('row-level security')
      setError(t(forbidden ? 'ui.matchScreens.forms.createForbidden' : 'ui.matchScreens.forms.createError'))
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
          <Label htmlFor="date">{t('ui.matchScreens.forms.date')}</Label>
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
          <Label htmlFor="time">{t('ui.matchScreens.forms.time')}</Label>
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
        <Label htmlFor="location">{t('ui.matchScreens.forms.locationOptional')}</Label>
        <Input
          id="location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          disabled={loading}
          placeholder={t('ui.matchScreens.forms.locationPlaceholder')}
          maxLength={200}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="maxPlayers">{t('ui.matchScreens.forms.maxPlayers')}</Label>
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
        <p className="text-xs text-muted-foreground">
          {t('ui.matchScreens.forms.maxPlayersHint')}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="durationMinutes">{t('ui.matchScreens.forms.duration')}</Label>
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
            {t('ui.matchScreens.forms.durationHint')}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="resultsRequestDelayMinutes">{t('ui.matchScreens.forms.resultsDelay')}</Label>
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
            {t('ui.matchScreens.forms.resultsDelayHint')}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">{t('ui.matchScreens.forms.notesOptional')}</Label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={loading}
          placeholder={t('ui.matchScreens.forms.notesPlaceholder')}
          maxLength={500}
          rows={2}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={openSignup}
          onChange={(e) => setOpenSignup(e.target.checked)}
          disabled={loading}
          className="h-4 w-4 rounded-sm border-input accent-chalk"
        />
        <div>
          <p className="text-sm font-medium">{t('ui.matchScreens.forms.openSignup')}</p>
          <p className="text-xs text-muted-foreground">
            {t('ui.matchScreens.forms.openSignupHint')}
          </p>
        </div>
      </label>

      <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row">
        <Button type="submit" disabled={loading} className="w-full sm:w-auto">
          {loading && <Spinner size="sm" className="mr-2" />}
          {t('ui.matchScreens.forms.createMatch')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={loading}
          className="w-full sm:w-auto"
        >
          {t('ui.matchScreens.forms.cancel')}
        </Button>
      </div>
    </form>
  )
}
