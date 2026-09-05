'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'

interface AddGuestFormProps {
  matchId: string
  isFull: boolean
  maxPlayers: number
  confirmedCount: number
}

export function AddGuestForm({
  matchId,
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
      const args: Database['public']['Functions']['admin_add_guest_signup']['Args'] = {
        p_match_id: matchId,
        p_display_name: name.trim(),
        p_notes: notes.trim() || undefined,
      }
      const { error: signupError } = await supabase.rpc('admin_add_guest_signup', args)

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
