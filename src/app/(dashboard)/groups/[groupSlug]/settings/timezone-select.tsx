'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/form-controls'
import { useT } from '@/i18n/provider'

// Time zone picker shared by the create-group form, the group settings and the
// recurring match: a handful of common Argentina/LatAm/EU zones, plus "Otra" to
// type anything IANA-valid the list doesn't have. The DB validates against
// pg_timezone_names (00025 for recurring patterns, 00028 for groups).

export const TIMEZONE_PRESETS = [
  'America/Argentina/Buenos_Aires',
  'America/Montevideo',
  'America/Santiago',
  'America/Sao_Paulo',
  'America/Bogota',
  'America/Lima',
  'America/Mexico_City',
  'Europe/Madrid',
]

const CUSTOM = '__custom__'

/** Same check the DB triggers do, done in the browser first for a readable error. */
export function isValidTimezone(tz: string) {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

interface TimezoneSelectProps {
  id: string
  value: string
  onChange: (timezone: string) => void
  disabled?: boolean
  /** An extra zone to list next to the presets (e.g. the browser's own). */
  extraOption?: string | null
}

export function TimezoneSelect({ id, value, onChange, disabled, extraOption }: TimezoneSelectProps) {
  const t = useT()
  const options = Array.from(
    new Set([...(extraOption && isValidTimezone(extraOption) ? [extraOption] : []), ...TIMEZONE_PRESETS])
  )
  // Start in "Otra" when the stored zone is not one of the listed options.
  const [custom, setCustom] = useState(() => value !== '' && !options.includes(value))
  const listed = !custom && options.includes(value)

  return (
    <div>
      <NativeSelect
        id={id}
        value={listed ? value : CUSTOM}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true)
            onChange('')
          } else {
            setCustom(false)
            onChange(e.target.value)
          }
        }}
        disabled={disabled}
      >
        {options.map((tz) => (
          <option key={tz} value={tz}>{tz}</option>
        ))}
        <option value={CUSTOM}>{t('ui.lifecycle.recurring.customTimezone')}</option>
      </NativeSelect>
      {!listed && (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          disabled={disabled}
          aria-label={t('ui.lifecycle.recurring.timezone')}
          placeholder={t('ui.lifecycle.recurring.customTimezonePlaceholder')}
          className="mt-2 font-mono text-sm"
        />
      )}
    </div>
  )
}
