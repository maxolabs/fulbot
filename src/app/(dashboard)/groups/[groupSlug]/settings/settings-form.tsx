'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'

interface GroupSettingsFormProps {
  group: {
    id: string
    name: string
    slug: string
    description: string | null
    default_match_day: number | null
    default_match_time: string | null
    default_max_players: number
  }
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

export function GroupSettingsForm({ group }: GroupSettingsFormProps) {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (supabase as any)
        .from('groups')
        .update({
          name,
          description: description || null,
          default_match_day: defaultMatchDay,
          default_match_time: defaultMatchTime,
          default_max_players: defaultMaxPlayers,
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
          Cambios guardados correctamente
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="name">Nombre del grupo</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={loading}
          maxLength={50}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Descripción</Label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={loading}
          maxLength={200}
          placeholder="Opcional"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="defaultMatchDay">Día habitual</Label>
          <select
            id="defaultMatchDay"
            value={defaultMatchDay}
            onChange={(e) => setDefaultMatchDay(Number(e.target.value))}
            disabled={loading}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {DAYS.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="defaultMatchTime">Hora habitual</Label>
          <Input
            id="defaultMatchTime"
            type="time"
            value={defaultMatchTime}
            onChange={(e) => setDefaultMatchTime(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="defaultMaxPlayers">Jugadores máx.</Label>
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

      <Button type="submit" disabled={loading}>
        {loading && <Spinner size="sm" className="mr-2" />}
        Guardar cambios
      </Button>
    </form>
  )
}
