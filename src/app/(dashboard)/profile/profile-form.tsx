'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'

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
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (supabase as any)
        .from('player_profiles')
        .update({
          display_name: displayName,
          nickname: nickname || null,
          main_position: mainPosition,
          preferred_positions: preferredPositions.length > 0 ? preferredPositions : [mainPosition],
          footedness,
          goalkeeper_willingness: goalkeeperWillingness,
          fitness_status: fitnessStatus,
        })
        .eq('id', profile.id)

      if (updateError) throw updateError

      setSuccess(true)
      router.refresh()
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      console.error('Error updating profile:', err)
      setError('Error al guardar los cambios')
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
      {success && (
        <div className="rounded-md bg-green-500/10 px-4 py-3 text-sm text-green-600">
          Perfil actualizado correctamente
        </div>
      )}

      {/* Basic Info */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="displayName">Nombre</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            disabled={loading}
            maxLength={50}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nickname">Apodo (opcional)</Label>
          <Input
            id="nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            disabled={loading}
            maxLength={20}
            placeholder="Cómo te dicen"
          />
        </div>
      </div>

      {/* Position */}
      <div className="space-y-2">
        <Label htmlFor="mainPosition">Posición principal</Label>
        <select
          id="mainPosition"
          value={mainPosition}
          onChange={(e) => setMainPosition(e.target.value)}
          disabled={loading}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {positions.map((pos) => (
            <option key={pos.value} value={pos.value}>
              {pos.label}
            </option>
          ))}
        </select>
      </div>

      {/* Preferred Positions */}
      <div className="space-y-2">
        <Label>Otras posiciones que jugarías (máx. 4)</Label>
        <div className="flex flex-wrap gap-2">
          {positions.map((pos) => (
            <button
              key={pos.value}
              type="button"
              onClick={() => handlePositionToggle(pos.value)}
              disabled={loading}
              className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                preferredPositions.includes(pos.value)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background hover:bg-muted border-input'
              }`}
            >
              {pos.value}
            </button>
          ))}
        </div>
      </div>

      {/* Footedness */}
      <div className="space-y-2">
        <Label>Pie hábil</Label>
        <div className="flex gap-4">
          {[
            { value: 'right', label: 'Diestro' },
            { value: 'left', label: 'Zurdo' },
            { value: 'both', label: 'Ambidiestro' },
          ].map((option) => (
            <label key={option.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="footedness"
                value={option.value}
                checked={footedness === option.value}
                onChange={(e) => setFootedness(e.target.value as 'left' | 'right' | 'both')}
                disabled={loading}
                className="h-4 w-4"
              />
              <span className="text-sm">{option.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Goalkeeper willingness */}
      <div className="space-y-2">
        <Label htmlFor="goalkeeperWillingness">
          Disposición para atajar (0 = nunca, 3 = me encanta)
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
            className="flex-1"
          />
          <span className="text-sm font-medium w-8 text-center">
            {goalkeeperWillingness}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {goalkeeperWillingness === 0 && 'No atajo ni loco'}
          {goalkeeperWillingness === 1 && 'Solo si no hay otra opción'}
          {goalkeeperWillingness === 2 && 'Puedo atajar si hace falta'}
          {goalkeeperWillingness === 3 && 'Me gusta atajar'}
        </p>
      </div>

      {/* Fitness status */}
      <div className="space-y-2">
        <Label>Estado físico actual</Label>
        <div className="flex gap-4">
          {[
            { value: 'ok', label: 'Bien', description: 'Al 100%' },
            { value: 'limited', label: 'Limitado', description: 'Puedo jugar pero con cuidado' },
            { value: 'injured', label: 'Lesionado', description: 'No puedo jugar' },
          ].map((option) => (
            <label
              key={option.value}
              className={`flex-1 p-3 rounded-lg border cursor-pointer transition-colors ${
                fitnessStatus === option.value
                  ? 'border-primary bg-primary/5'
                  : 'border-input hover:bg-muted'
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
        {loading && <Spinner size="sm" className="mr-2" />}
        Guardar cambios
      </Button>
    </form>
  )
}
