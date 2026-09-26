'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import { FormNotice, NativeSelect } from '@/components/form-controls'
import type { Json } from '@/types/database'
import { useT } from '@/i18n/provider'
import { TimezoneSelect, isValidTimezone } from './timezone-select'

interface GroupSettingsFormProps {
  group: {
    id: string
    name: string
    slug: string
    description: string | null
    default_match_day: number | null
    default_match_time: string | null
    default_max_players: number
    timezone: string | null
    settings: Json | null
  }
}

// Weights applied to each member's match report when computing the consensus
// result (docs/match-results-consensus.md §4). Stored in groups.settings.result_weights.
const DEFAULT_RESULT_WEIGHTS = { admin: 1.5, captain: 1.25, member: 1.0 }
type ResultWeights = typeof DEFAULT_RESULT_WEIGHTS

function readResultWeights(settings: Json | null): ResultWeights {
  const raw =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, Json | undefined>).result_weights
      : undefined
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, Json | undefined>) : {}
  const num = (key: keyof ResultWeights) => {
    const v = obj[key]
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : DEFAULT_RESULT_WEIGHTS[key]
  }
  return { admin: num('admin'), captain: num('captain'), member: num('member') }
}

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
const MIN_WEIGHT = 0.05
const MAX_WEIGHT = 10

export function GroupSettingsForm({ group }: GroupSettingsFormProps) {
  const t = useT()
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description || '')
  const [defaultMatchDay, setDefaultMatchDay] = useState(group.default_match_day ?? 1)
  const [defaultMatchTime, setDefaultMatchTime] = useState(group.default_match_time || '21:00')
  const [defaultMaxPlayers, setDefaultMaxPlayers] = useState(group.default_max_players)
  const [timezone, setTimezone] = useState(group.timezone || 'America/Argentina/Buenos_Aires')
  const [weights, setWeights] = useState<ResultWeights>(() => readResultWeights(group.settings))

  const setWeight = (key: keyof ResultWeights, value: number) => {
    setWeights(prev => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const invalid = (Object.keys(weights) as (keyof ResultWeights)[]).some(
        k => !Number.isFinite(weights[k]) || weights[k] < MIN_WEIGHT || weights[k] > MAX_WEIGHT
      )
      if (invalid) {
        setError(t('ui.screens.groupSettings.weightsInvalid'))
        setLoading(false)
        return
      }
      if (!isValidTimezone(timezone)) {
        setError(t(timezone ? 'ui.lifecycle.invalidTimezone' : 'ui.lifecycle.timezoneRequired'))
        setLoading(false)
        return
      }

      // Keep every other key of groups.settings intact; only replace result_weights.
      const existingSettings =
        group.settings && typeof group.settings === 'object' && !Array.isArray(group.settings)
          ? (group.settings as Record<string, Json | undefined>)
          : {}
      const nextSettings = { ...existingSettings, result_weights: weights }

       
      const { error: updateError } = await (supabase as any)
        .from('groups')
        .update({
          name,
          description: description || null,
          default_match_day: defaultMatchDay,
          default_match_time: defaultMatchTime,
          default_max_players: defaultMaxPlayers,
          timezone,
          settings: nextSettings,
        })
        .eq('id', group.id)

      if (updateError) {
        throw updateError
      }

      setSuccess(true)
      router.refresh()
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      console.error('Error updating group:', err)
      // groups_validate_timezone (00028) raises 22023 for a zone Postgres doesn't know.
      const dbError = err as { code?: string; message?: string }
      if (dbError?.code === '22023' || dbError?.message?.includes('invalid_timezone')) {
        setError(t('ui.lifecycle.invalidTimezone'))
      } else {
        setError(t('ui.screens.groupSettings.saveError'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <FormNotice kind="error">{error}</FormNotice>}
      {success && <FormNotice kind="success">{t('ui.screens.groupSettings.saved')}</FormNotice>}

      <div className="space-y-1.5">
        <Label htmlFor="name">{t('ui.screens.groupSettings.nameLabel')}</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={loading}
          maxLength={50}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">{t('ui.screens.groupSettings.descriptionLabel')}</Label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={loading}
          maxLength={200}
          placeholder={t('ui.screens.groupSettings.descriptionPlaceholder')}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="defaultMatchDay">{t('ui.screens.groupSettings.defaultDay')}</Label>
          <NativeSelect
            id="defaultMatchDay"
            value={defaultMatchDay}
            onChange={(e) => setDefaultMatchDay(Number(e.target.value))}
            disabled={loading}
          >
            {DAY_KEYS.map((key, value) => (
              <option key={key} value={value}>
                {t(`days.${key}`)}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="defaultMatchTime">{t('ui.screens.groupSettings.defaultTime')}</Label>
          <Input
            id="defaultMatchTime"
            type="time"
            value={defaultMatchTime}
            onChange={(e) => setDefaultMatchTime(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="defaultMaxPlayers">{t('ui.screens.groupSettings.maxPlayers')}</Label>
          <Input
            id="defaultMaxPlayers"
            type="number"
            min={4}
            max={30}
            value={defaultMaxPlayers}
            onChange={(e) => setDefaultMaxPlayers(Number(e.target.value))}
            disabled={loading}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="groupTimezone">{t('ui.screens.groupSettings.timezone')}</Label>
        <TimezoneSelect
          id="groupTimezone"
          value={timezone}
          onChange={setTimezone}
          disabled={loading}
          extraOption={group.timezone}
        />
        <p className="text-xs text-muted-foreground">{t('ui.screens.groupSettings.timezoneHint')}</p>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">{t('ui.screens.groupSettings.weightsTitle')}</p>
          <p className="text-xs text-muted-foreground text-pretty">{t('ui.screens.groupSettings.weightsHint')}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="weightAdmin">{t('groups.roles.admin')}</Label>
            <Input
              id="weightAdmin"
              type="number"
              min={MIN_WEIGHT}
              max={MAX_WEIGHT}
              step={0.05}
              value={weights.admin}
              onChange={(e) => setWeight('admin', Number(e.target.value))}
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="weightCaptain">{t('groups.roles.captain')}</Label>
            <Input
              id="weightCaptain"
              type="number"
              min={MIN_WEIGHT}
              max={MAX_WEIGHT}
              step={0.05}
              value={weights.captain}
              onChange={(e) => setWeight('captain', Number(e.target.value))}
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="weightMember">{t('groups.roles.member')}</Label>
            <Input
              id="weightMember"
              type="number"
              min={MIN_WEIGHT}
              max={MAX_WEIGHT}
              step={0.05}
              value={weights.member}
              onChange={(e) => setWeight('member', Number(e.target.value))}
              disabled={loading}
            />
          </div>
        </div>
      </div>

      <Button type="submit" disabled={loading}>
        {loading && <Spinner size="sm" />}
        {t('ui.screens.groupSettings.save')}
      </Button>
    </form>
  )
}
