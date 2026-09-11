'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Minus, Save, Trash2, Goal, Lock, Unlock, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import type { AdminMatchEventInput, Json, MatchResultStatus } from '@/types/database'

interface TeamPlayer {
  id: string
  display_name: string
  is_guest: boolean
  player_id: string | null
  guest_player_id: string | null
}

interface TeamData {
  id: string
  name: 'dark' | 'light'
  color_hex: string
  score: number
  players: TeamPlayer[]
}

interface GoalEntry {
  team_id: string
  scorer_id: string
  assister_id: string | null
}

interface MatchResultsProps {
  matchId: string
  teams: TeamData[]
  existingEvents: {
    id: string
    team_id: string
    player_id: string | null
    guest_player_id: string | null
    event_type: string
    linked_event_id: string | null
  }[]
  resultStatus: MatchResultStatus
  lockedBy: string | null
  lockedAt: string | null
  mvpPlayerId: string | null
  /** Registered confirmed players of the match (MVP candidates). */
  mvpCandidates: { id: string; display_name: string }[]
}

const STATUS_LABEL: Record<MatchResultStatus, string> = {
  pending: 'Sin resultado todavía',
  provisional: 'Consenso provisional',
  consensus: 'Consenso alcanzado',
  locked: 'Resultado cerrado',
}

function goalsFromEvents(events: MatchResultsProps['existingEvents']): GoalEntry[] {
  const goalEvents = events.filter(e => e.event_type === 'goal')
  const assistEvents = events.filter(e => e.event_type === 'assist')
  return goalEvents.map(goal => {
    const assist = assistEvents.find(a => a.linked_event_id === goal.id)
    return {
      team_id: goal.team_id,
      scorer_id: goal.player_id || goal.guest_player_id || '',
      assister_id: assist ? (assist.player_id || assist.guest_player_id || null) : null,
    }
  })
}

export function MatchResults({
  matchId,
  teams,
  existingEvents,
  resultStatus,
  lockedBy,
  lockedAt,
  mvpPlayerId,
  mvpCandidates,
}: MatchResultsProps) {
  const router = useRouter()
  const supabase = createClient()

  const darkTeam = teams.find(t => t.name === 'dark')
  const lightTeam = teams.find(t => t.name === 'light')

  const [darkScore, setDarkScore] = useState(darkTeam?.score ?? 0)
  const [lightScore, setLightScore] = useState(lightTeam?.score ?? 0)
  const [goals, setGoals] = useState<GoalEntry[]>(() => goalsFromEvents(existingEvents))
  const [mvpId, setMvpId] = useState<string>(mvpPlayerId ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  // When locked the editor is collapsed behind "Corregir" so a re-save is deliberate.
  const [editingLocked, setEditingLocked] = useState(false)
  const [lockedByName, setLockedByName] = useState<string | null>(null)

  const isLocked = resultStatus === 'locked'

  // Keep the form in sync when the server data changes (consensus recompute, unlock).
  useEffect(() => {
    setDarkScore(darkTeam?.score ?? 0)
    setLightScore(lightTeam?.score ?? 0)
    setGoals(goalsFromEvents(existingEvents))
    setMvpId(mvpPlayerId ?? '')
    setEditingLocked(false)
  }, [existingEvents, darkTeam?.score, lightTeam?.score, mvpPlayerId, resultStatus])

  useEffect(() => {
    if (!isLocked || !lockedBy) {
      setLockedByName(null)
      return
    }
    let cancelled = false
    supabase
      .from('player_profiles')
      .select('display_name')
      .eq('id', lockedBy)
      .single()
      .then(({ data }) => {
        if (!cancelled) {
          setLockedByName((data as { display_name: string } | null)?.display_name ?? null)
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocked, lockedBy])

  if (!darkTeam || !lightTeam) return null

  const allPlayers = [...darkTeam.players, ...lightTeam.players]
  const getTeamGoals = (teamId: string) => goals.filter(g => g.team_id === teamId)
  const scoreFor = (team: TeamData) => (team.name === 'dark' ? darkScore : lightScore)
  const setScoreFor = (team: TeamData, value: number) => {
    const clamped = Math.max(0, Math.min(99, Number.isFinite(value) ? value : 0))
    if (team.name === 'dark') setDarkScore(clamped)
    else setLightScore(clamped)
  }
  const unattributedFor = (team: TeamData) => scoreFor(team) - getTeamGoals(team.id).length
  const overAttributed = teams.some(t => unattributedFor(t) < 0)

  const addGoal = (teamId: string) => {
    setGoals(prev => [...prev, { team_id: teamId, scorer_id: '', assister_id: null }])
    // A newly listed goal is a goal: bump the score if the list would exceed it.
    const team = teams.find(t => t.id === teamId)
    if (team && unattributedFor(team) <= 0) setScoreFor(team, scoreFor(team) + 1)
  }

  const removeGoal = (index: number) => {
    setGoals(prev => prev.filter((_, i) => i !== index))
  }

  const updateGoal = (index: number, patch: Partial<GoalEntry>) => {
    setGoals(prev => prev.map((g, i) => (i === index ? { ...g, ...patch } : g)))
  }

  const toEventRef = (id: string): Pick<AdminMatchEventInput, 'player_id' | 'guest_player_id'> => {
    const player = allPlayers.find(p => p.id === id)
    return player?.is_guest
      ? { player_id: null, guest_player_id: player.guest_player_id }
      : { player_id: player?.player_id ?? null, guest_player_id: null }
  }

  const handleSave = async () => {
    if (goals.some(g => !g.scorer_id)) {
      setError('Cada gol de la lista necesita un goleador. Si no sabés quién lo hizo, borrá la fila: el resultado ya lo cuenta.')
      return
    }
    if (overAttributed) {
      setError('Hay más goles cargados que los del resultado. Subí el resultado o borrá goles.')
      return
    }

    setSaving(true)
    setError(null)
    setSavedMessage(null)

    try {
      const events: AdminMatchEventInput[] = []
      goals.forEach(goal => {
        const goalIndex = events.length
        events.push({ team_id: goal.team_id, event_type: 'goal', ...toEventRef(goal.scorer_id) })
        if (goal.assister_id) {
          events.push({
            team_id: goal.team_id,
            event_type: 'assist',
            linked_index: goalIndex,
            ...toEventRef(goal.assister_id),
          })
        }
      })

      const { error: rpcError } = await supabase.rpc('admin_set_match_result', {
        p_match_id: matchId,
        p_dark_score: darkScore,
        p_light_score: lightScore,
        p_events: events as unknown as Json,
        p_mvp_player_id: mvpId || null,
      })
      if (rpcError) throw rpcError

      setSavedMessage('Resultado guardado y cerrado. Los reportes de los jugadores ya no lo modifican.')
      setEditingLocked(false)
      router.refresh()
    } catch (err) {
      console.error('Error saving results:', err)
      setError(err instanceof Error && err.message ? err.message : 'Error al guardar el resultado')
    } finally {
      setSaving(false)
    }
  }

  const handleUnlock = async () => {
    if (!confirm('Al reabrir, el resultado vuelve a calcularse con los reportes de los jugadores y lo que cargaste a mano se descarta. ¿Continuar?')) {
      return
    }
    setSaving(true)
    setError(null)
    setSavedMessage(null)
    try {
      const { error: rpcError } = await supabase.rpc('admin_unlock_match_result', { p_match_id: matchId })
      if (rpcError) throw rpcError
      setSavedMessage('Resultado reabierto: vuelve a seguir el consenso de los reportes.')
      router.refresh()
    } catch (err) {
      console.error('Error unlocking result:', err)
      setError(err instanceof Error && err.message ? err.message : 'Error al reabrir el resultado')
    } finally {
      setSaving(false)
    }
  }

  const renderTeamSection = (team: TeamData) => {
    const teamGoals = getTeamGoals(team.id)
    const teamLabel = team.name === 'dark' ? 'Oscuro' : 'Claro'
    const unattributed = unattributedFor(team)

    return (
      <div key={team.id} className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: team.color_hex }} />
            <span className="font-medium">{teamLabel}</span>
            <div className="flex items-center gap-1 ml-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Restar gol a ${teamLabel}`}
                onClick={() => setScoreFor(team, scoreFor(team) - 1)}
                disabled={saving || scoreFor(team) <= 0}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <input
                type="number"
                min={0}
                max={99}
                value={scoreFor(team)}
                onChange={e => setScoreFor(team, Number(e.target.value))}
                aria-label={`Goles de ${teamLabel}`}
                className="w-14 text-center text-2xl font-bold rounded-md border border-input bg-background py-1"
                disabled={saving}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Sumar gol a ${teamLabel}`}
                onClick={() => setScoreFor(team, scoreFor(team) + 1)}
                disabled={saving}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => addGoal(team.id)} disabled={saving}>
            <Plus className="h-4 w-4 mr-1" />
            Goleador
          </Button>
        </div>

        {unattributed > 0 && (
          <p className="text-xs text-muted-foreground pl-6">
            {unattributed === 1 ? '1 gol sin autor' : `${unattributed} goles sin autor`}
          </p>
        )}
        {unattributed < 0 && (
          <p className="text-xs text-destructive pl-6">
            Hay {-unattributed} {-unattributed === 1 ? 'gol cargado de más' : 'goles cargados de más'} respecto al resultado
          </p>
        )}

        {teamGoals.map(goal => {
          const globalIndex = goals.indexOf(goal)
          return (
            <div key={globalIndex} className="flex items-start gap-2 pl-6">
              <div className="flex-1 grid gap-2 sm:grid-cols-2">
                <select
                  value={goal.scorer_id}
                  onChange={e => updateGoal(globalIndex, { scorer_id: e.target.value })}
                  aria-label="Goleador"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  disabled={saving}
                >
                  <option value="">Seleccionar goleador...</option>
                  {team.players.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.display_name}
                    </option>
                  ))}
                </select>
                <select
                  value={goal.assister_id || ''}
                  onChange={e => updateGoal(globalIndex, { assister_id: e.target.value || null })}
                  aria-label="Asistencia"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  disabled={saving}
                >
                  <option value="">Asistencia (opcional)</option>
                  {team.players
                    .filter(p => p.id !== goal.scorer_id)
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.display_name}
                      </option>
                    ))}
                </select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Quitar gol"
                onClick={() => removeGoal(globalIndex)}
                className="text-destructive hover:text-destructive mt-1"
                disabled={saving}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )
        })}
      </div>
    )
  }

  const lockedAtLabel = lockedAt
    ? new Date(lockedAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
    : null

  const showEditor = !isLocked || editingLocked

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          {isLocked ? <Lock className="h-5 w-5" /> : <Goal className="h-5 w-5" />}
          {isLocked ? 'Resultado cerrado' : 'Cargar resultado'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}
        {savedMessage && (
          <div className="rounded-md bg-green-500/10 px-4 py-3 text-sm text-green-600">{savedMessage}</div>
        )}

        {isLocked && (
          <div className="rounded-md border px-4 py-3 text-sm space-y-3">
            <p>
              Cerrado{lockedByName ? ` por ${lockedByName}` : ''}{lockedAtLabel ? ` el ${lockedAtLabel}` : ''}.
              Los reportes que lleguen ahora se guardan pero no cambian el resultado.
            </p>
            <div className="flex flex-wrap gap-2">
              {!editingLocked && (
                <Button type="button" variant="outline" size="sm" onClick={() => setEditingLocked(true)} disabled={saving}>
                  <Pencil className="h-4 w-4 mr-1" />
                  Corregir resultado
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={handleUnlock} disabled={saving}>
                {saving ? <Spinner size="sm" className="mr-1" /> : <Unlock className="h-4 w-4 mr-1" />}
                Reabrir (volver al consenso)
              </Button>
            </div>
          </div>
        )}

        {!isLocked && (
          <p className="text-sm text-muted-foreground">
            {STATUS_LABEL[resultStatus]}. Lo que ves abajo es lo que dicen los reportes hasta ahora; al guardar,
            tu versión pasa a ser la definitiva y se cierra.
          </p>
        )}

        {showEditor && (
          <>
            <div className="border-t pt-4 space-y-6">
              {renderTeamSection(darkTeam)}
              {renderTeamSection(lightTeam)}
            </div>

            <div className="space-y-2">
              <label htmlFor="mvp-select" className="text-sm font-medium">
                MVP
              </label>
              <select
                id="mvp-select"
                value={mvpId}
                onChange={e => setMvpId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                disabled={saving}
              >
                <option value="">Mantener el más votado</option>
                {mvpCandidates.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </select>
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? <Spinner size="sm" className="mr-2" /> : <Save className="mr-2 h-4 w-4" />}
              Guardar y cerrar resultado
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
