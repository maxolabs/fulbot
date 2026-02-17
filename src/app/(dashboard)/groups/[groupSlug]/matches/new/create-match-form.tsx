'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'

interface CreateMatchFormProps {
  groupId: string
  groupSlug: string
  defaults: {
    date: string
    time: string
    maxPlayers: number
  }
}

export function CreateMatchForm({ groupId, groupSlug, defaults }: CreateMatchFormProps) {
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [date, setDate] = useState(defaults.date)
  const [time, setTime] = useState(defaults.time)
  const [location, setLocation] = useState('')
  const [maxPlayers, setMaxPlayers] = useState(defaults.maxPlayers)
  const [notes, setNotes] = useState('')
  const [openSignup, setOpenSignup] = useState(true)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Combine date and time into ISO datetime
      const dateTime = new Date(`${date}T${time}:00`).toISOString()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: match, error: insertError } = await (supabase as any)
        .from('matches')
        .insert({
          group_id: groupId,
          date_time: dateTime,
          location: location || null,
          max_players: maxPlayers,
          notes: notes || null,
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
      setError('Error al crear el partido')
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="date">Fecha</Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="time">Hora</Label>
          <Input
            id="time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
            disabled={loading}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="location">Lugar (opcional)</Label>
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
        <Label htmlFor="maxPlayers">Jugadores máximo</Label>
        <Input
          id="maxPlayers"
          type="number"
          min={4}
          max={30}
          value={maxPlayers}
          onChange={(e) => setMaxPlayers(Number(e.target.value))}
          required
          disabled={loading}
        />
        <p className="text-xs text-muted-foreground">
          Cuando se alcance el límite, los siguientes quedarán en lista de espera
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notas (opcional)</Label>
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

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={openSignup}
          onChange={(e) => setOpenSignup(e.target.checked)}
          disabled={loading}
          className="h-4 w-4 rounded border-input"
        />
        <div>
          <p className="text-sm font-medium">Abrir inscripciones inmediatamente</p>
          <p className="text-xs text-muted-foreground">
            Si no, el partido quedará como borrador
          </p>
        </div>
      </label>

      <div className="flex gap-3">
        <Button type="submit" disabled={loading}>
          {loading && <Spinner size="sm" className="mr-2" />}
          Crear partido
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={loading}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}
