'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/provider'
import type { Json, MemberScoringPriorityMode, MemberScoringSettings } from '@/types/database'

interface MemberScoringSettingsCardProps {
  groupId: string
}

// Order of the per-event weights in the "Avanzado" block. Mirrors the defaults
// of member_scoring_settings() in 00021; the RPC always returns every key.
const EVENT_KEYS = [
  'attended',
  'no_show',
  'late_cancel',
  'arrived_late',
  'wrong_jersey',
  'unpaid',
  'reported_result',
  'rated_teammates',
  'voted_mvp',
  'rated_new_member',
  'peer_kudos',
] as const

const DIMENSION_KEYS = ['asistencia', 'aviso', 'puntualidad', 'reglas', 'participacion'] as const
type DimensionKey = (typeof DIMENSION_KEYS)[number]

const PRIORITY_MODES: MemberScoringPriorityMode[] = ['off', 'window', 'waitlist', 'reserved']

function Toggle({
  id,
  checked,
  onChange,
  disabled,
}: {
  id?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? 'bg-primary' : 'bg-gray-200'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string
  label: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1 min-w-0">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Toggle id={id} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  )
}

function RadioOption({
  name,
  value,
  current,
  label,
  hint,
  onChange,
  disabled,
}: {
  name: string
  value: string
  current: string
  label: string
  hint: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const id = `${name}-${value}`
  const selected = current === value
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
        selected ? 'border-primary bg-primary/5' : 'border-border/50 hover:border-border'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={selected}
        onChange={() => onChange(value)}
        disabled={disabled}
        className="mt-1 h-4 w-4 shrink-0 accent-primary"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  )
}

function readNumber(value: string, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function MemberScoringSettingsCard({ groupId }: MemberScoringSettingsCardProps) {
  const router = useRouter()
  const supabase = createClient()
  const t = useT()

  const [settings, setSettings] = useState<MemberScoringSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .rpc('member_scoring_settings', { p_group_id: groupId })
      .then(({ data, error: rpcError }) => {
        if (cancelled) return
        if (rpcError || !data) {
          setLoadError(rpcError?.message ?? t('memberScoring.settings.loadError'))
          return
        }
        setSettings(data as MemberScoringSettings)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  const update = (patch: Partial<MemberScoringSettings>) => {
    setSettings(prev => (prev ? { ...prev, ...patch } : prev))
  }
  const updatePriority = (patch: Partial<MemberScoringSettings['priority']>) => {
    setSettings(prev => (prev ? { ...prev, priority: { ...prev.priority, ...patch } } : prev))
  }
  const updateWeight = (key: string, value: number) => {
    setSettings(prev => (prev ? { ...prev, weights: { ...prev.weights, [key]: value } } : prev))
  }
  const updateDimension = (key: DimensionKey, value: number) => {
    setSettings(prev => (prev ? { ...prev, dimensions: { ...prev.dimensions, [key]: value } } : prev))
  }

  const dimensionSum = settings
    ? round2(DIMENSION_KEYS.reduce((acc, k) => acc + (Number(settings.dimensions[k]) || 0), 0))
    : 0
  const dimensionsValid = Math.abs(dimensionSum - 1) <= 0.001

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const positiveInts = [settings.window_matches, settings.late_cancel_hours, settings.min_matches_for_score]
      const priorityNumbers = [settings.priority.threshold, settings.priority.window_hours, settings.priority.reserved_spots]
      const invalid =
        positiveInts.some(n => !Number.isFinite(n) || n <= 0) ||
        priorityNumbers.some(n => !Number.isFinite(n) || n <= 0) ||
        EVENT_KEYS.some(k => !Number.isFinite(settings.weights[k])) ||
        DIMENSION_KEYS.some(k => !Number.isFinite(settings.dimensions[k]) || settings.dimensions[k] < 0)
      if (invalid) {
        setError(t('memberScoring.settings.invalidNumbers'))
        return
      }
      if (!dimensionsValid) {
        setError(t('memberScoring.settings.dimensionSumError', { sum: dimensionSum.toFixed(2) }))
        return
      }

      // Re-read groups.settings right before writing so other tenants of the
      // column (result_weights, saved from the general form) are never clobbered.
      const { data: groupRow, error: readError } = await supabase
        .from('groups')
        .select('settings')
        .eq('id', groupId)
        .single()
      if (readError) throw readError

      const existingSettings =
        groupRow?.settings && typeof groupRow.settings === 'object' && !Array.isArray(groupRow.settings)
          ? (groupRow.settings as Record<string, Json | undefined>)
          : {}
      const memberScoring: Json = {
        enabled: settings.enabled,
        window_matches: Math.round(settings.window_matches),
        late_cancel_hours: settings.late_cancel_hours,
        min_matches_for_score: Math.round(settings.min_matches_for_score),
        weights: { ...settings.weights },
        dimensions: { ...settings.dimensions },
        visibility: settings.visibility,
        priority: {
          mode: settings.priority.mode,
          threshold: settings.priority.threshold,
          window_hours: settings.priority.window_hours,
          reserved_spots: Math.round(settings.priority.reserved_spots),
        },
        no_show_cooldown: settings.no_show_cooldown,
        captains_can_report: settings.captains_can_report,
      }
      const nextSettings = { ...existingSettings, member_scoring: memberScoring }

      const { error: updateError } = await (supabase as any)
        .from('groups')
        .update({ settings: nextSettings })
        .eq('id', groupId)
      if (updateError) throw updateError

      const { error: recomputeError } = await supabase.rpc('admin_recompute_member_scores', { p_group_id: groupId })
      if (recomputeError) throw recomputeError

      setSuccess(true)
      router.refresh()
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      console.error('Error saving member scoring settings:', err)
      setError(t('memberScoring.settings.saveError'))
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return <p className="text-sm text-destructive">{loadError}</p>
  }

  if (!settings) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner size="sm" /> {t('memberScoring.settings.loading')}
      </div>
    )
  }

  const disabled = saving
  const mode = settings.priority.mode

  return (
    <div className="space-y-6">
      {error && <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
      {success && (
        <div className="rounded-md bg-green-500/10 px-4 py-3 text-sm text-green-600">
          {t('memberScoring.settings.saved')}
        </div>
      )}

      <ToggleRow
        id="ms-enabled"
        label={t('memberScoring.settings.enabled')}
        hint={t('memberScoring.settings.enabledHint')}
        checked={settings.enabled}
        onChange={v => update({ enabled: v })}
        disabled={disabled}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="ms-window-matches">{t('memberScoring.settings.windowMatches')}</Label>
          <Input
            id="ms-window-matches"
            type="number"
            min={1}
            max={100}
            step={1}
            value={settings.window_matches}
            onChange={e => update({ window_matches: readNumber(e.target.value, settings.window_matches) })}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">{t('memberScoring.settings.windowMatchesHint')}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ms-late-cancel">{t('memberScoring.settings.lateCancelHours')}</Label>
          <Input
            id="ms-late-cancel"
            type="number"
            min={1}
            max={168}
            step={1}
            value={settings.late_cancel_hours}
            onChange={e => update({ late_cancel_hours: readNumber(e.target.value, settings.late_cancel_hours) })}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">{t('memberScoring.settings.lateCancelHoursHint')}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ms-min-matches">{t('memberScoring.settings.minMatches')}</Label>
          <Input
            id="ms-min-matches"
            type="number"
            min={1}
            max={100}
            step={1}
            value={settings.min_matches_for_score}
            onChange={e =>
              update({ min_matches_for_score: readNumber(e.target.value, settings.min_matches_for_score) })
            }
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">{t('memberScoring.settings.minMatchesHint')}</p>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium mb-2">{t('memberScoring.settings.visibility')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <RadioOption
            name="ms-visibility"
            value="self"
            current={settings.visibility}
            label={t('memberScoring.settings.visibilitySelf')}
            hint={t('memberScoring.settings.visibilitySelfHint')}
            onChange={v => update({ visibility: v as MemberScoringSettings['visibility'] })}
            disabled={disabled}
          />
          <RadioOption
            name="ms-visibility"
            value="group"
            current={settings.visibility}
            label={t('memberScoring.settings.visibilityGroup')}
            hint={t('memberScoring.settings.visibilityGroupHint')}
            onChange={v => update({ visibility: v as MemberScoringSettings['visibility'] })}
            disabled={disabled}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium mb-2">{t('memberScoring.settings.priority')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRIORITY_MODES.map(m => (
            <RadioOption
              key={m}
              name="ms-priority"
              value={m}
              current={mode}
              label={t(`memberScoring.settings.priority${m.charAt(0).toUpperCase()}${m.slice(1)}`)}
              hint={t(`memberScoring.settings.priority${m.charAt(0).toUpperCase()}${m.slice(1)}Hint`)}
              onChange={v => updatePriority({ mode: v as MemberScoringPriorityMode })}
              disabled={disabled}
            />
          ))}
        </div>

        {mode !== 'off' && (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="ms-threshold">{t('memberScoring.settings.threshold')}</Label>
              <Input
                id="ms-threshold"
                type="number"
                min={1}
                max={5}
                step={0.1}
                value={settings.priority.threshold}
                onChange={e => updatePriority({ threshold: readNumber(e.target.value, settings.priority.threshold) })}
                disabled={disabled}
              />
            </div>
            {(mode === 'window' || mode === 'reserved') && (
              <div className="space-y-2">
                <Label htmlFor="ms-window-hours">
                  {mode === 'reserved'
                    ? t('memberScoring.settings.windowHoursBeforeKickoff')
                    : t('memberScoring.settings.windowHours')}
                </Label>
                <Input
                  id="ms-window-hours"
                  type="number"
                  min={1}
                  max={720}
                  step={1}
                  value={settings.priority.window_hours}
                  onChange={e =>
                    updatePriority({ window_hours: readNumber(e.target.value, settings.priority.window_hours) })
                  }
                  disabled={disabled}
                />
              </div>
            )}
            {mode === 'reserved' && (
              <div className="space-y-2">
                <Label htmlFor="ms-reserved-spots">{t('memberScoring.settings.reservedSpots')}</Label>
                <Input
                  id="ms-reserved-spots"
                  type="number"
                  min={1}
                  max={30}
                  step={1}
                  value={settings.priority.reserved_spots}
                  onChange={e =>
                    updatePriority({ reserved_spots: readNumber(e.target.value, settings.priority.reserved_spots) })
                  }
                  disabled={disabled}
                />
              </div>
            )}
          </div>
        )}
      </fieldset>

      <ToggleRow
        id="ms-no-show-cooldown"
        label={t('memberScoring.settings.noShowCooldown')}
        hint={t('memberScoring.settings.noShowCooldownHint')}
        checked={settings.no_show_cooldown}
        onChange={v => update({ no_show_cooldown: v })}
        disabled={disabled}
      />

      <ToggleRow
        id="ms-captains-can-report"
        label={t('memberScoring.settings.captainsCanReport')}
        hint={t('memberScoring.settings.captainsCanReportHint')}
        checked={settings.captains_can_report}
        onChange={v => update({ captains_can_report: v })}
        disabled={disabled}
      />

      {/* Avanzado: per-event points and dimension weights */}
      <div className="rounded-xl border border-border/50">
        <button
          type="button"
          onClick={() => setAdvancedOpen(o => !o)}
          aria-expanded={advancedOpen}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
        >
          {t('memberScoring.settings.advanced')}
          {advancedOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </button>

        {advancedOpen && (
          <div className="space-y-6 border-t border-border/50 px-4 py-4">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">{t('memberScoring.settings.eventWeights')}</p>
                <p className="text-xs text-muted-foreground">{t('memberScoring.settings.eventWeightsHint')}</p>
              </div>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                {EVENT_KEYS.map(key => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`ms-weight-${key}`} className="text-xs">
                      {t(`memberScoring.settings.events.${key}`)}
                    </Label>
                    <Input
                      id={`ms-weight-${key}`}
                      type="number"
                      min={-50}
                      max={50}
                      step={1}
                      value={settings.weights[key] ?? 0}
                      onChange={e => updateWeight(key, readNumber(e.target.value, settings.weights[key] ?? 0))}
                      disabled={disabled}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">{t('memberScoring.settings.dimensionWeights')}</p>
                <p className="text-xs text-muted-foreground">{t('memberScoring.settings.dimensionWeightsHint')}</p>
              </div>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
                {DIMENSION_KEYS.map(key => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`ms-dim-${key}`} className="text-xs">
                      {t(`memberScoring.settings.dimensions.${key}`)}
                    </Label>
                    <Input
                      id={`ms-dim-${key}`}
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={settings.dimensions[key]}
                      onChange={e => updateDimension(key, readNumber(e.target.value, settings.dimensions[key]))}
                      disabled={disabled}
                    />
                  </div>
                ))}
              </div>
              <p className={`text-sm font-medium ${dimensionsValid ? 'text-green-600' : 'text-destructive'}`}>
                {t('memberScoring.settings.dimensionSum', { sum: dimensionSum.toFixed(2) })}
              </p>
              {!dimensionsValid && (
                <p className="text-xs text-destructive">
                  {t('memberScoring.settings.dimensionSumError', { sum: dimensionSum.toFixed(2) })}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <Button type="button" onClick={handleSave} disabled={saving || !dimensionsValid}>
        {saving && <Spinner size="sm" className="mr-2" />}
        {t('memberScoring.settings.save')}
      </Button>
    </div>
  )
}
