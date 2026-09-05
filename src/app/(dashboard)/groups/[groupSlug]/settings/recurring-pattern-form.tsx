'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Repeat, Save, Power } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'

interface RecurringPatternFormProps {
  groupId: string
  groupDefaults: {
    default_match_day: number | null
    default_match_time: string | null
    default_max_players: number
    timezone: string
  }
  pattern: {
    id: string
    weekday: number
    match_time: string
    location: string | null
    max_players: number
    signup_opens_weekday: number
    signup_opens_time: string
    timezone: string
    is_active: boolean
  } | null
}

const DAYS = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
]

// A handful of common Argentina/LatAm/EU zones; "Otra" lets an admin type
// anything IANA-valid the select doesn't list.
const TIMEZONE_PRESETS = [
  'America/Argentina/Buenos_Aires',
  'America/Montevideo',
  'America/Santiago',
  'America/Sao_Paulo',
  'America/Bogota',
  'America/Lima',
  'America/Mexico_City',
  'Europe/Madrid',
]

function trimTime(t: string) {
  // Inputs come back as "HH:mm:ss"; <input type="time"> wants "HH:mm".
  return t.slice(0, 5)
}

export function RecurringPatternForm({ groupId, groupDefaults, pattern: initialPattern }: RecurringPatternFormProps) {
  const router = useRouter()
  const supabase = createClient()

  const defaultWeekday = initialPattern?.weekday ?? groupDefaults.default_match_day ?? 1
  const defaultSignupWeekday = initialPattern?.signup_opens_weekday ?? ((defaultWeekday - 1 + 7) % 7)
  const defaultTimezone = initialPattern?.timezone ?? groupDefaults.timezone ?? 'America/Argentina/Buenos_Aires'
  const isPresetTimezone = TIMEZONE_PRESETS.includes(defaultTimezone)

  const [patternId, setPatternId] = useState(initialPattern?.id ?? null)
  const [isActive, setIsActive] = useState(initialPattern?.is_active ?? true)
  const [weekday, setWeekday] = useState(defaultWeekday)
  const [matchTime, setMatchTime] = useState(
    initialPattern ? trimTime(initialPattern.match_time) : (groupDefaults.default_match_time ? trimTime(groupDefaults.default_match_time) : '21:00')
  )
  const [location, setLocation] = useState(initialPattern?.location ?? '')
  const [maxPlayers, setMaxPlayers] = useState(initialPattern?.max_players ?? groupDefaults.default_max_players)
  const [signupOpensWeekday, setSignupOpensWeekday] = useState(defaultSignupWeekday)
  const [signupOpensTime, setSignupOpensTime] = useState(
    initialPattern ? trimTime(initialPattern.signup_opens_time) : '12:00'
  )
  const [timezoneChoice, setTimezoneChoice] = useState(isPresetTimezone ? defaultTimezone : '__custom__')
  const [customTimezone, setCustomTimezone] = useState(isPresetTimezone ? '' : defaultTimezone)

  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveTimezone = timezoneChoice === '__custom__' ? customTimezone.trim() : timezoneChoice

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      if (!effectiveTimezone) {
        throw new Error('Ingresá una zona horaria')
      }

      const payload = {
        group_id: groupId,
        weekday,
        match_time: matchTime,
        location: location.trim() || null,
        max_players: maxPlayers,
        signup_opens_weekday: signupOpensWeekday,
        signup_opens_time: signupOpensTime,
        timezone: effectiveTimezone,
        is_active: true,
      }

      if (patternId) {
        const { error: updateError } = await supabase
          .from('recurring_patterns')
          .update(payload)
          .eq('id', patternId)

        if (updateError) throw updateError
        setIsActive(true)
      } else {
        const { data: created, error: insertError } = await supabase
          .from('recurring_patterns')
          .insert(payload)
          .select('id')
          .single()

        if (insertError) throw insertError
        setPatternId(created.id)
        setIsActive(true)
      }

      setSuccess(true)
      router.refresh()
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      console.error('Error saving recurring pattern:', err)
      setError(err instanceof Error ? err.message : 'Error al guardar el partido recurrente')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleActive = async () => {
    if (!patternId) return
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const { error: updateError } = await supabase
        .from('recurring_patterns')
        .update({ is_active: !isActive })
        .eq('id', patternId)

      if (updateError) throw updateError

      setIsActive(!isActive)
      router.refresh()
    } catch (err) {
      console.error('Error toggling recurring pattern:', err)
      setError('Error al actualizar el partido recurrente')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center gap-2">
        <Repeat className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Crea automáticamente el próximo partido cada semana, con inscripciones que abren solas.
        </p>
        {patternId && (
          <Badge variant={isActive ? 'default' : 'outline'} className="ml-auto">
            {isActive ? 'Activo' : 'Inactivo'}
          </Badge>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md bg-green-500/10 px-4 py-3 text-sm text-green-600">
          Partido recurrente guardado correctamente
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="weekday">Día del partido</Label>
          <select
            id="weekday"
            value={weekday}
            onChange={(e) => setWeekday(Number(e.target.value))}
            disabled={loading}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {DAYS.map((day) => (
              <option key={day.value} value={day.value}>{day.label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="matchTime">Hora del partido</Label>
          <Input
            id="matchTime"
            type="time"
            value={matchTime}
            onChange={(e) => setMatchTime(e.target.value)}
            disabled={loading}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="location">Lugar</Label>
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
          <Label htmlFor="maxPlayers">Jugadores máx.</Label>
          <Input
            id="maxPlayers"
            type="number"
            min={4}
            max={30}
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(Number(e.target.value))}
            disabled={loading}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="signupOpensWeekday">Día en que abre inscripción</Label>
          <select
            id="signupOpensWeekday"
            value={signupOpensWeekday}
            onChange={(e) => setSignupOpensWeekday(Number(e.target.value))}
            disabled={loading}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {DAYS.map((day) => (
              <option key={day.value} value={day.value}>{day.label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="signupOpensTime">Hora en que abre inscripción</Label>
          <Input
            id="signupOpensTime"
            type="time"
            value={signupOpensTime}
            onChange={(e) => setSignupOpensTime(e.target.value)}
            disabled={loading}
            required
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="timezone">Zona horaria</Label>
          <select
            id="timezone"
            value={timezoneChoice}
            onChange={(e) => setTimezoneChoice(e.target.value)}
            disabled={loading}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {TIMEZONE_PRESETS.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
            <option value="__custom__">Otra (escribir)…</option>
          </select>
          {timezoneChoice === '__custom__' && (
            <Input
              value={customTimezone}
              onChange={(e) => setCustomTimezone(e.target.value)}
              disabled={loading}
              placeholder="Ej: America/Cordoba"
              className="mt-2 font-mono text-sm"
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={loading}>
          {loading ? <Spinner size="sm" className="mr-2" /> : <Save className="mr-2 h-4 w-4" />}
          Guardar
        </Button>
        {patternId && (
          <Button type="button" variant="outline" onClick={handleToggleActive} disabled={loading}>
            <Power className="mr-2 h-4 w-4" />
            {isActive ? 'Desactivar' : 'Activar'}
          </Button>
        )}
      </div>
    </form>
  )
}
