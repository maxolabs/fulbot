'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'

const DAYS = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
]

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/-+/g, '-') // Replace multiple - with single -
    .trim()
}

export default function NewGroupPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)
  const [description, setDescription] = useState('')
  const [defaultMatchDay, setDefaultMatchDay] = useState(1) // Monday
  const [defaultMatchTime, setDefaultMatchTime] = useState('21:00')
  const [defaultMaxPlayers, setDefaultMaxPlayers] = useState(14)

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setName(newName)
    if (!slugManuallyEdited) {
      setSlug(slugify(newName))
    }
  }

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSlugManuallyEdited(true)
    setSlug(slugify(e.target.value))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const response = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          slug,
          description: description || undefined,
          defaultMatchDay,
          defaultMatchTime,
          defaultMaxPlayers,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Error al crear el grupo')
        return
      }

      router.push(`/groups/${data.slug}`)
      router.refresh()
    } catch {
      setError('Error de conexión. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back button */}
      <Link
        href="/groups"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Volver a mis grupos
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Crear nuevo grupo</CardTitle>
          <CardDescription>
            Crea un grupo para organizar partidos de fútbol con tus amigos
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6">
            {error && (
              <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* Group Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Nombre del grupo *</Label>
              <Input
                id="name"
                placeholder="Ej: Fútbol lunes"
                value={name}
                onChange={handleNameChange}
                required
                disabled={loading}
                maxLength={50}
              />
            </div>

            {/* Slug */}
            <div className="space-y-2">
              <Label htmlFor="slug">URL del grupo *</Label>
              <div className="flex items-center">
                <span className="text-sm text-muted-foreground mr-2">
                  futbot.app/groups/
                </span>
                <Input
                  id="slug"
                  placeholder="futbol-lunes"
                  value={slug}
                  onChange={handleSlugChange}
                  required
                  disabled={loading}
                  maxLength={30}
                  className="flex-1"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Solo letras minúsculas, números y guiones
              </p>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Descripción (opcional)</Label>
              <Input
                id="description"
                placeholder="Partidos de fútbol 7 todos los lunes"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={loading}
                maxLength={200}
              />
            </div>

            {/* Default settings */}
            <div className="border-t pt-6">
              <h3 className="font-medium mb-4">Configuración por defecto</h3>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Default day */}
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

                {/* Default time */}
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

                {/* Max players */}
                <div className="space-y-2">
                  <Label htmlFor="defaultMaxPlayers">Jugadores máximos</Label>
                  <Input
                    id="defaultMaxPlayers"
                    type="number"
                    min={4}
                    max={30}
                    value={defaultMaxPlayers}
                    onChange={(e) => setDefaultMaxPlayers(Number(e.target.value))}
                    disabled={loading}
                  />
                  <p className="text-xs text-muted-foreground">
                    Para fútbol 7: 14 jugadores (7 vs 7)
                  </p>
                </div>
              </div>
            </div>

            {/* Submit */}
            <div className="flex gap-3 pt-4">
              <Button type="submit" disabled={loading || !name || !slug}>
                {loading && <Spinner size="sm" className="mr-2" />}
                Crear grupo
              </Button>
              <Link href="/groups">
                <Button type="button" variant="outline" disabled={loading}>
                  Cancelar
                </Button>
              </Link>
            </div>
          </CardContent>
        </form>
      </Card>
    </div>
  )
}
