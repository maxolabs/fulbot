'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'

interface AddGuestFormProps {
  matchId: string
  groupId: string
  isFull: boolean
  maxPlayers: number
  confirmedCount: number
}

export function AddGuestForm({
  matchId,
  groupId,
  isFull,
  maxPlayers,
  confirmedCount,
}: AddGuestFormProps) {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setLoading(true)
    setError(null)

    try {
      // Create guest player
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: guest, error: guestError } = await (supabase as any)
        .from('guest_players')
        .insert({
          display_name: name.trim(),
          notes: notes.trim() || null,
          group_id: groupId,
        })
        .select('id')
        .single()

      if (guestError) throw guestError

      // Create signup for this guest
      const status = confirmedCount < maxPlayers ? 'confirmed' : 'waitlist'
      const waitlistPosition = status === 'waitlist' ? confirmedCount - maxPlayers + 1 : null

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: signupError } = await (supabase as any)
        .from('match_signups')
        .insert({
          match_id: matchId,
          guest_player_id: guest.id,
          status,
          waitlist_position: waitlistPosition,
          notes: notes.trim() || null,
        })

      if (signupError) throw signupError

      setName('')
      setNotes('')
      setOpen(false)
      router.refresh()
    } catch (err) {
      console.error('Error adding guest:', err)
      setError('Error al agregar invitado')
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        className="w-full justify-start"
        onClick={() => setOpen(true)}
      >
        <UserPlus className="mr-2 h-4 w-4" />
        Agregar invitado
      </Button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-4 border rounded-lg">
      <h4 className="font-medium text-sm">Agregar jugador invitado</h4>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="guest-name">Nombre *</Label>
        <Input
          id="guest-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del invitado"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="guest-notes">Notas</Label>
        <Input
          id="guest-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ej: amigo de Juan, juega de delantero"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {isFull
          ? 'El partido está completo. El invitado irá a lista de espera.'
          : `Quedan ${maxPlayers - confirmedCount} lugares disponibles.`}
      </p>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={loading || !name.trim()}>
          {loading && <Spinner size="sm" className="mr-2" />}
          Agregar
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}
