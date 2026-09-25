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
import { FormNotice, NativeSelect } from '@/components/form-controls'
import { useT } from '@/i18n/provider'

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
  { value: 0, key: 'days.sunday' },
  { value: 1, key: 'days.monday' },
  { value: 2, key: 'days.tuesday' },
  { value: 3, key: 'days.wednesday' },
  { value: 4, key: 'days.thursday' },
  { value: 5, key: 'days.friday' },
  { value: 6, key: 'days.saturday' },
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

// Same check the DB trigger does against pg_timezone_names (00025), done in
// the browser first so the admin gets a readable error.
function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

function trimTime(t: string) {
  // Inputs come back as "HH:mm:ss"; <input type="time"> wants "HH:mm".
  return t.slice(0, 5)
}

export function RecurringPatternForm({ groupId, groupDefaults, pattern: initialPattern }: RecurringPatternFormProps) {
  const router = useRouter()
  const supabase = createClient()
  const t = useT()

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
    setError(null)
    setSuccess(false)

    if (!effectiveTimezone) {
      setError(t('ui.lifecycle.timezoneRequired'))
      return
    }
    if (!isValidTimezone(effectiveTimezone)) {
      setError(t('ui.lifecycle.invalidTimezone'))
      return
    }

    setLoading(true)
    try {
      const payload = {
        group_id: groupId,
        weekday,
        match_time: matchTime,
        location: location.trim() || null,
        max_players: maxPlayers,
        signup_opens_weekday: signupOpensWeekday,
        signup_opens_time: signupOpensTime,
        timezone: effectiveTimezone,
      }

      // Saving keeps the current on/off state; only the toggle changes it.
      if (patternId) {
        const { error: updateError } = await supabase
          .from('recurring_patterns')
          .update(payload)
          .eq('id', patternId)

        if (updateError) throw updateError
      } else {
        const { data: created, error: insertError } = await supabase
          .from('recurring_patterns')
          .insert({ ...payload, is_active: isActive })
          .select('id')
          .single()

        if (insertError) throw insertError
        setPatternId(created.id)
      }

      setSuccess(true)
      router.refresh()
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      console.error('Error saving recurring pattern:', err)
      // The DB trigger raises 22023 / invalid_timezone for a zone Postgres doesn't know.
      const dbError = err as { code?: string; message?: string }
      if (dbError?.code === '22023' || dbError?.message?.includes('invalid_timezone')) {
        setError(t('ui.lifecycle.invalidTimezone'))
      } else {
        setError(t('ui.lifecycle.recurring.saveError'))
      }
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
      setError(t('ui.lifecycle.recurring.toggleError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center gap-2">
        <Repeat className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          {t('ui.lifecycle.recurring.intro')}
        </p>
        {patternId && (
          <Badge variant={isActive ? 'success' : 'outline'} className="ml-auto">
            {isActive ? t('ui.lifecycle.recurring.active') : t('ui.lifecycle.recurring.inactive')}
          </Badge>
        )}
      </div>

      {error && <FormNotice kind="error">{error}</FormNotice>}
      {success && <FormNotice kind="success">{t('ui.lifecycle.recurring.saved')}</FormNotice>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="weekday">{t('ui.lifecycle.recurring.weekday')}</Label>
          <NativeSelect
            id="weekday"
            value={weekday}
            onChange={(e) => setWeekday(Number(e.target.value))}
            disabled={loading}
          >
            {DAYS.map((day) => (
              <option key={day.value} value={day.value}>{t(day.key)}</option>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="matchTime">{t('ui.lifecycle.recurring.matchTime')}</Label>
          <Input
            id="matchTime"
            type="time"
            value={matchTime}
            onChange={(e) => setMatchTime(e.target.value)}
            disabled={loading}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="location">{t('ui.lifecycle.recurring.location')}</Label>
          <Input
            id="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            disabled={loading}
            placeholder={t('ui.lifecycle.recurring.locationPlaceholder')}
            maxLength={200}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="maxPlayers">{t('ui.lifecycle.recurring.maxPlayers')}</Label>
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

        <div className="space-y-1.5">
          <Label htmlFor="signupOpensWeekday">{t('ui.lifecycle.recurring.signupWeekday')}</Label>
          <NativeSelect
            id="signupOpensWeekday"
            value={signupOpensWeekday}
            onChange={(e) => setSignupOpensWeekday(Number(e.target.value))}
            disabled={loading}
          >
            {DAYS.map((day) => (
              <option key={day.value} value={day.value}>{t(day.key)}</option>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signupOpensTime">{t('ui.lifecycle.recurring.signupTime')}</Label>
          <Input
            id="signupOpensTime"
            type="time"
            value={signupOpensTime}
            onChange={(e) => setSignupOpensTime(e.target.value)}
            disabled={loading}
            required
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="timezone">{t('ui.lifecycle.recurring.timezone')}</Label>
          <NativeSelect
            id="timezone"
            value={timezoneChoice}
            onChange={(e) => setTimezoneChoice(e.target.value)}
            disabled={loading}
          >
            {TIMEZONE_PRESETS.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
            <option value="__custom__">{t('ui.lifecycle.recurring.customTimezone')}</option>
          </NativeSelect>
          {timezoneChoice === '__custom__' && (
            <Input
              value={customTimezone}
              onChange={(e) => setCustomTimezone(e.target.value)}
              disabled={loading}
              placeholder={t('ui.lifecycle.recurring.customTimezonePlaceholder')}
              className="mt-2 font-mono text-sm"
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={loading}>
          {loading ? <Spinner size="sm" /> : <Save className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />}
          {t('common.save')}
        </Button>
        {patternId && (
          <Button type="button" variant="outline" onClick={handleToggleActive} disabled={loading}>
            <Power className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            {isActive ? t('ui.lifecycle.recurring.deactivate') : t('ui.lifecycle.recurring.activate')}
          </Button>
        )}
      </div>
    </form>
  )
}
