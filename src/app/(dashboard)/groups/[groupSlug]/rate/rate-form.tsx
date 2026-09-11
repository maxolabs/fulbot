'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, ChevronUp, SkipForward, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'
import {
  DIMENSION_HINTS,
  DIMENSION_LABELS,
  PLAYER_TAGS,
  RATING_DIMENSIONS,
  RATING_SCALE_LABELS,
  tagLabel,
  type RatingDimension,
} from '@/lib/ratings'

export interface RateMember {
  id: string
  displayName: string
  nickname: string | null
  mainPosition: string
}

export interface ExistingRating {
  skipped: boolean
  goalkeeping: number | null
  defense: number | null
  attack: number | null
  physical: number | null
  tags: string[]
  is_baseline: boolean
}

interface RateMembersFormProps {
  groupId: string
  groupSlug: string
  voterPlayerId: string
  isBaseline: boolean
  focusPlayerId: string | null
  members: RateMember[]
  existing: Record<string, ExistingRating>
}

type Draft = {
  dims: Partial<Record<RatingDimension, number>>
  tags: string[]
}

const POSITION_LABELS: Record<string, string> = {
  GK: 'Arquero',
  CB: 'Defensor',
  LB: 'Lateral Izq.',
  RB: 'Lateral Der.',
  CDM: 'Volante Def.',
  CM: 'Mediocampista',
  CAM: 'Enganche',
  LM: 'Medio Izq.',
  RM: 'Medio Der.',
  LW: 'Extremo Izq.',
  RW: 'Extremo Der.',
  ST: 'Delantero',
  CF: 'Centro Delantero',
}

function draftFrom(entry: ExistingRating | undefined): Draft {
  if (!entry || entry.skipped) return { dims: {}, tags: [] }
  return {
    dims: {
      goalkeeping: entry.goalkeeping ?? undefined,
      defense: entry.defense ?? undefined,
      attack: entry.attack ?? undefined,
      physical: entry.physical ?? undefined,
    },
    tags: entry.tags,
  }
}

export function RateMembersForm({
  groupId,
  groupSlug,
  voterPlayerId,
  isBaseline,
  focusPlayerId,
  members,
  existing,
}: RateMembersFormProps) {
  const router = useRouter()
  const supabase = createClient()

  const [entries, setEntries] = useState<Record<string, ExistingRating>>(existing)
  const [openId, setOpenId] = useState<string | null>(() => {
    if (focusPlayerId && members.some((m) => m.id === focusPlayerId)) return focusPlayerId
    return members.find((m) => !existing[m.id])?.id ?? null
  })
  const [draft, setDraft] = useState<Draft>(() => draftFrom(openId ? existing[openId] : undefined))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pending first (the focused player at the very top), then skipped, then rated.
  const ordered = useMemo(() => {
    const rank = (m: RateMember) => {
      if (m.id === focusPlayerId) return 0
      const e = entries[m.id]
      if (!e) return 1
      if (e.skipped) return 2
      return 3
    }
    return [...members].sort((a, b) => rank(a) - rank(b))
  }, [members, entries, focusPlayerId])

  const doneCount = members.filter((m) => entries[m.id]).length
  const ratedCount = members.filter((m) => entries[m.id] && !entries[m.id].skipped).length
  const pendingCount = members.length - doneCount

  const open = (playerId: string) => {
    setError(null)
    setOpenId(playerId)
    setDraft(draftFrom(entries[playerId]))
  }

  const advance = (fromId: string, nextEntries: Record<string, ExistingRating>) => {
    const next = ordered.find((m) => m.id !== fromId && !nextEntries[m.id])
    if (next) {
      setOpenId(next.id)
      setDraft(draftFrom(undefined))
    } else {
      setOpenId(null)
    }
  }

  const persist = async (playerId: string, row: ExistingRating) => {
    setSaving(true)
    setError(null)
    try {
      const payload: Database['public']['Tables']['peer_ratings']['Insert'] = {
        group_id: groupId,
        voter_player_id: voterPlayerId,
        rated_player_id: playerId,
        skipped: row.skipped,
        goalkeeping: row.goalkeeping,
        defense: row.defense,
        attack: row.attack,
        physical: row.physical,
        tags: row.tags,
        is_baseline: row.is_baseline,
      }
      const { error: upsertError } = await supabase
        .from('peer_ratings')
        .upsert(payload, { onConflict: 'group_id,voter_player_id,rated_player_id' })
      if (upsertError) throw upsertError

      const nextEntries = { ...entries, [playerId]: row }
      setEntries(nextEntries)
      advance(playerId, nextEntries)
      router.refresh()
    } catch (err) {
      console.error('Error saving rating:', err)
      setError('No se pudo guardar la calificación. Probá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  const handleSave = (playerId: string) => {
    const complete = RATING_DIMENSIONS.every((dim) => draft.dims[dim] !== undefined)
    if (!complete) return
    void persist(playerId, {
      skipped: false,
      goalkeeping: draft.dims.goalkeeping!,
      defense: draft.dims.defense!,
      attack: draft.dims.attack!,
      physical: draft.dims.physical!,
      tags: draft.tags,
      is_baseline: isBaseline,
    })
  }

  const handleSkip = (playerId: string) => {
    void persist(playerId, {
      skipped: true,
      goalkeeping: null,
      defense: null,
      attack: null,
      physical: null,
      tags: [],
      is_baseline: isBaseline,
    })
  }

  const toggleTag = (key: string) => {
    setDraft((d) => ({
      ...d,
      tags: d.tags.includes(key) ? d.tags.filter((t) => t !== key) : [...d.tags, key],
    }))
  }

  const draftComplete = RATING_DIMENSIONS.every((dim) => draft.dims[dim] !== undefined)

  if (members.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Todavía no hay otros jugadores en el grupo.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Progress */}
      <Card>
        <CardContent className="py-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>
              {doneCount} de {members.length} listos
              <span className="text-muted-foreground"> · {ratedCount} calificados</span>
            </span>
            {pendingCount === 0 ? (
              <Badge variant="secondary">Completo</Badge>
            ) : (
              <span className="text-muted-foreground">{pendingCount} pendientes</span>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(doneCount / members.length) * 100}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {pendingCount === 0 && openId === null && (
        <Card className="border-primary/30">
          <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="font-medium flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                ¡Listo! No te queda nadie por calificar.
              </p>
              <p className="text-sm text-muted-foreground">
                Podés volver a editar cualquier calificación cuando quieras.
              </p>
            </div>
            <Link href={`/groups/${groupSlug}`}>
              <Button variant="outline" size="sm">Volver al grupo</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {ordered.map((member) => {
          const entry = entries[member.id]
          const isOpen = openId === member.id
          const status = !entry ? 'pending' : entry.skipped ? 'skipped' : 'rated'

          return (
            <Card key={member.id} className={isOpen ? 'border-primary/50' : ''}>
              <CardContent className="py-3">
                <button
                  type="button"
                  onClick={() => (isOpen ? setOpenId(null) : open(member.id))}
                  className="w-full flex items-center gap-3 text-left"
                >
                  <Avatar fallback={member.displayName} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {member.displayName}
                      {member.nickname && (
                        <span className="text-muted-foreground ml-1">({member.nickname})</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {POSITION_LABELS[member.mainPosition] || member.mainPosition}
                    </p>
                  </div>
                  {status === 'rated' && (
                    <span className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                      {RATING_DIMENSIONS.map((dim) => (
                        <span key={dim}>
                          {DIMENSION_LABELS[dim].slice(0, 3).toUpperCase()}{' '}
                          <span className="font-medium text-foreground">{entry![dim]}</span>
                        </span>
                      ))}
                    </span>
                  )}
                  <Badge
                    variant={status === 'rated' ? 'secondary' : 'outline'}
                    className="text-xs shrink-0"
                  >
                    {status === 'pending' ? 'Pendiente' : status === 'skipped' ? 'Omitido' : 'Calificado'}
                  </Badge>
                  {isOpen ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : status === 'pending' ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <Pencil className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </button>

                {isOpen && (
                  <div className="mt-4 pt-4 border-t space-y-5">
                    {RATING_DIMENSIONS.map((dim) => {
                      const value = draft.dims[dim]
                      return (
                        <div key={dim} className="space-y-1.5">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm font-medium">{DIMENSION_LABELS[dim]}</span>
                            <span className="text-xs text-muted-foreground">
                              {value ? RATING_SCALE_LABELS[value] : DIMENSION_HINTS[dim]}
                            </span>
                          </div>
                          <div className="grid grid-cols-5 gap-1.5">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => setDraft((d) => ({ ...d, dims: { ...d.dims, [dim]: n } }))}
                                className={`h-10 rounded-md border text-sm font-medium transition-colors ${
                                  value === n
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : value !== undefined && n < value
                                      ? 'border-primary/40 bg-primary/10'
                                      : 'border-border hover:bg-muted/50'
                                }`}
                                aria-label={`${DIMENSION_LABELS[dim]} ${n}`}
                                aria-pressed={value === n}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}

                    <div className="space-y-1.5">
                      <span className="text-sm font-medium">¿Qué lo describe? <span className="text-muted-foreground font-normal">(opcional)</span></span>
                      <div className="flex flex-wrap gap-1.5">
                        {PLAYER_TAGS.map((tag) => {
                          const active = draft.tags.includes(tag.key)
                          return (
                            <button
                              key={tag.key}
                              type="button"
                              onClick={() => toggleTag(tag.key)}
                              aria-pressed={active}
                              className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
                                active
                                  ? 'border-primary bg-primary/15 text-foreground'
                                  : 'border-border text-muted-foreground hover:bg-muted/50'
                              }`}
                            >
                              {tagLabel(tag.key)}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => handleSkip(member.id)}
                        disabled={saving}
                      >
                        <SkipForward className="mr-2 h-4 w-4" />
                        No lo conozco, omitir
                      </Button>
                      <Button onClick={() => handleSave(member.id)} disabled={saving || !draftComplete}>
                        {saving ? <Spinner size="sm" className="mr-2" /> : <Check className="mr-2 h-4 w-4" />}
                        Guardar
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
