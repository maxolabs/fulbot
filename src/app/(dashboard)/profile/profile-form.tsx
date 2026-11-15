'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import { FormNotice, NativeSelect } from '@/components/form-controls'
import { useT } from '@/i18n/provider'

interface ProfileFormProps {
  profile: {
    id: string
    display_name: string
    nickname: string | null
    preferred_positions: string[]
    main_position: string
    footedness: 'left' | 'right' | 'both'
    goalkeeper_willingness: number
    fitness_status: 'ok' | 'limited' | 'injured'
  }
  positions: { value: string; label: string }[]
}

export function ProfileForm({ profile, positions }: ProfileFormProps) {
  const router = useRouter()
  const supabase = createClient()
  const t = useT()

  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [displayName, setDisplayName] = useState(profile.display_name)
  const [nickname, setNickname] = useState(profile.nickname || '')
  const [mainPosition, setMainPosition] = useState(profile.main_position)
  const [preferredPositions, setPreferredPositions] = useState<string[]>(profile.preferred_positions)
  const [footedness, setFootedness] = useState(profile.footedness)
  const [goalkeeperWillingness, setGoalkeeperWillingness] = useState(profile.goalkeeper_willingness)
  const [fitnessStatus, setFitnessStatus] = useState(profile.fitness_status)

  const handlePositionToggle = (position: string) => {
    setPreferredPositions((prev) => {
      if (prev.includes(position)) {
        return prev.filter((p) => p !== position)
      }
      if (prev.length >= 4) {
        return prev
      }
      return [...prev, position]
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    // player_profiles_display_name_length (00027): trimmed, 1..50.
    const trimmedName = displayName.trim()
    const trimmedNickname = nickname.trim()
    if (!trimmedName) {
      setError(t('ui.profileForm.nameRequired'))
      return
    }
    setDisplayName(trimmedName)
    setNickname(trimmedNickname)
    setLoading(true)

    try {
      const { error: updateError } = await supabase
        .from('player_profiles')
        .update({
          display_name: trimmedName,
          nickname: trimmedNickname || null,
          main_position: mainPosition,
          preferred_positions: preferredPositions.length > 0 ? preferredPositions : [mainPosition],
          footedness,
          goalkeeper_willingness: goalkeeperWillingness,
          fitness_status: fitnessStatus,
          // Hides the "Contanos dónde jugás" row on the group home (00028).
          profile_completed_at: new Date().toISOString(),
        })
        .eq('id', profile.id)

      if (updateError) throw updateError

      setSuccess(true)
      router.refresh()
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      console.error('Error updating profile:', err)
      // The CHECK constraint is the server-side guard for a blank name (23514).
      const dbError = err as { code?: string; message?: string }
      const blankName = dbError?.code === '23514' && !!dbError.message?.includes('player_profiles_display_name_length')
      setError(t(blankName ? 'ui.profileForm.nameRequired' : 'ui.profileForm.saveError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <FormNotice kind="error">{error}</FormNotice>}
      {success && <FormNotice kind="success">{t('ui.profileForm.saved')}</FormNotice>}

      {/* Basic Info */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="displayName">{t('ui.profileForm.name')}</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            disabled={loading}
            maxLength={50}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nickname">{t('ui.profileForm.nickname')}</Label>
          <Input
            id="nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            disabled={loading}
            maxLength={20}
            placeholder={t('ui.profileForm.nicknamePlaceholder')}
          />
        </div>
      </div>

      {/* Position */}
      <div className="space-y-1.5">
        <Label htmlFor="mainPosition">{t('players.mainPosition')}</Label>
        <NativeSelect
          id="mainPosition"
          value={mainPosition}
          onChange={(e) => setMainPosition(e.target.value)}
          disabled={loading}
        >
          {positions.map((pos) => (
            <option key={pos.value} value={pos.value}>
              {pos.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      {/* Preferred Positions */}
      <div className="space-y-1.5">
        <Label>{t('ui.profileForm.otherPositions')}</Label>
        <div className="flex flex-wrap gap-2">
          {positions.map((pos) => (
            <button
              key={pos.value}
              type="button"
              onClick={() => handlePositionToggle(pos.value)}
              disabled={loading}
              aria-pressed={preferredPositions.includes(pos.value)}
              className={`min-h-9 rounded-sm border px-2.5 py-1.5 font-mono text-xs uppercase tracking-[.08em] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card ${
                preferredPositions.includes(pos.value)
                  ? 'border-foreground bg-accent text-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent/60'
              }`}
            >
              {pos.value}
            </button>
          ))}
        </div>
      </div>

      {/* Footedness */}
      <div className="space-y-1.5">
        <Label>{t('players.footedness')}</Label>
        <div className="flex flex-wrap gap-4 pt-1">
          {[
            { value: 'right', label: t('ui.screens.player.rightFooted') },
            { value: 'left', label: t('ui.screens.player.leftFooted') },
            { value: 'both', label: t('ui.screens.player.bothFooted') },
          ].map((option) => (
            <label key={option.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="footedness"
                value={option.value}
                checked={footedness === option.value}
                onChange={(e) => setFootedness(e.target.value as 'left' | 'right' | 'both')}
                disabled={loading}
                className="h-4 w-4 accent-primary"
              />
              <span className="text-sm">{option.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Goalkeeper willingness */}
      <div className="space-y-1.5">
        <Label htmlFor="goalkeeperWillingness">
          {t('ui.profileForm.gkLabel')}
        </Label>
        <div className="flex items-center gap-4">
          <input
            type="range"
            id="goalkeeperWillingness"
            min={0}
            max={3}
            value={goalkeeperWillingness}
            onChange={(e) => setGoalkeeperWillingness(Number(e.target.value))}
            disabled={loading}
            className="flex-1 accent-primary"
          />
          <span className="w-8 text-center font-mono text-sm tabular-nums">
            {goalkeeperWillingness}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {t(['ui.screens.player.gkNever', 'ui.screens.player.gkIfNeeded', 'ui.screens.player.gkOk', 'ui.screens.player.gkLoves'][goalkeeperWillingness] ?? 'ui.screens.player.gkOk')}
        </p>
      </div>

      {/* Fitness status */}
      <div className="space-y-1.5">
        <Label>{t('ui.profileForm.fitnessLabel')}</Label>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
          {[
            { value: 'ok', label: t('players.ok'), description: t('ui.profileForm.fitnessOkDesc') },
            { value: 'limited', label: t('players.limited'), description: t('ui.profileForm.fitnessLimitedDesc') },
            { value: 'injured', label: t('players.injured'), description: t('ui.profileForm.fitnessInjuredDesc') },
          ].map((option) => (
            <label
              key={option.value}
              className={`flex-1 cursor-pointer rounded-md border p-3 transition-colors duration-100 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-card ${
                fitnessStatus === option.value
                  ? 'border-foreground bg-accent'
                  : 'border-border hover:bg-accent/60'
              }`}
            >
              <input
                type="radio"
                name="fitnessStatus"
                value={option.value}
                checked={fitnessStatus === option.value}
                onChange={(e) =>
                  setFitnessStatus(e.target.value as 'ok' | 'limited' | 'injured')
                }
                disabled={loading}
                className="sr-only"
              />
              <span className="block font-medium text-sm">{option.label}</span>
              <span className="block text-xs text-muted-foreground">{option.description}</span>
            </label>
          ))}
        </div>
      </div>

      <Button type="submit" disabled={loading}>
        {loading && <Spinner size="sm" />}
        {t('ui.profileForm.save')}
      </Button>
    </form>
  )
}
