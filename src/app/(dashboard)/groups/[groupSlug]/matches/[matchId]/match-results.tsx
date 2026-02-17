'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Minus, Save, Trash2, Goal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'

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
  id?: string
  team_id: string
  scorer_id: string
  scorer_is_guest: boolean
  assister_id: string | null
  assister_is_guest: boolean
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
  resultsFinalized: boolean
}

export function MatchResults({ matchId, teams, existingEvents, resultsFinalized }: MatchResultsProps) {
  const router = useRouter()
  const supabase = createClient()
  const [goals, setGoals] = useState<GoalEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [finalized, setFinalized] = useState(false)

  // Check if results were already finalized (events exist)
  const hasExistingEvents = existingEvents.length > 0

  // Initialize goals from existing events
  useEffect(() => {
    if (hasExistingEvents) {
      const goalEvents = existingEvents.filter(e => e.event_type === 'goal')
      const assistEvents = existingEvents.filter(e => e.event_type === 'assist')

      const initialGoals: GoalEntry[] = goalEvents.map(goal => {
        const assist = assistEvents.find(a => a.linked_event_id === goal.id)
        return {
          id: goal.id,
          team_id: goal.team_id,
          scorer_id: goal.player_id || goal.guest_player_id || '',
          scorer_is_guest: !!goal.guest_player_id,
          assister_id: assist ? (assist.player_id || assist.guest_player_id || null) : null,
          assister_is_guest: assist ? !!assist.guest_player_id : false,
        }
      })
      setGoals(initialGoals)
    }
  }, [hasExistingEvents, existingEvents])

  const darkTeam = teams.find(t => t.name === 'dark')
  const lightTeam = teams.find(t => t.name === 'light')

  if (!darkTeam || !lightTeam) return null

  const allPlayers = [...darkTeam.players, ...lightTeam.players]

  const getTeamGoals = (teamId: string) => goals.filter(g => g.team_id === teamId)

  const addGoal = (teamId: string) => {
    setGoals(prev => [
      ...prev,
      {
        team_id: teamId,
        scorer_id: '',
        scorer_is_guest: false,
        assister_id: null,
        assister_is_guest: false,
      },
    ])
  }

  const removeGoal = (index: number) => {
    setGoals(prev => prev.filter((_, i) => i !== index))
  }

  const updateGoalScorer = (index: number, value: string) => {
    setGoals(prev => {
      const updated = [...prev]
      const player = allPlayers.find(p => p.id === value)
      updated[index] = {
        ...updated[index],
        scorer_id: value,
        scorer_is_guest: player?.is_guest ?? false,
      }
      return updated
    })
  }

  const updateGoalAssister = (index: number, value: string) => {
    setGoals(prev => {
      const updated = [...prev]
      if (!value) {
        updated[index] = { ...updated[index], assister_id: null, assister_is_guest: false }
      } else {
        const player = allPlayers.find(p => p.id === value)
        updated[index] = {
          ...updated[index],
          assister_id: value,
          assister_is_guest: player?.is_guest ?? false,
        }
      }
      return updated
    })
  }

  const handleSave = async () => {
    // Validate all goals have scorers
    const invalidGoals = goals.filter(g => !g.scorer_id)
    if (invalidGoals.length > 0) {
      alert('Cada gol necesita un goleador')
      return
    }

    setSaving(true)

    try {
      // Delete existing events for this match
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('match_events')
        .delete()
        .eq('match_id', matchId)

      // Insert goal events
      for (const goal of goals) {
        const scorerPlayer = allPlayers.find(p => p.id === goal.scorer_id)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: goalEvent, error: goalError } = await (supabase as any)
          .from('match_events')
          .insert({
            match_id: matchId,
            team_id: goal.team_id,
            player_id: scorerPlayer?.is_guest ? null : scorerPlayer?.player_id,
            guest_player_id: scorerPlayer?.is_guest ? scorerPlayer?.guest_player_id : null,
            event_type: 'goal',
          })
          .select('id')
          .single()

        if (goalError) throw goalError

        // Insert assist if present
        if (goal.assister_id) {
          const assisterPlayer = allPlayers.find(p => p.id === goal.assister_id)

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: assistError } = await (supabase as any)
            .from('match_events')
            .insert({
              match_id: matchId,
              team_id: goal.team_id,
              player_id: assisterPlayer?.is_guest ? null : assisterPlayer?.player_id,
              guest_player_id: assisterPlayer?.is_guest ? assisterPlayer?.guest_player_id : null,
              event_type: 'assist',
              linked_event_id: goalEvent.id,
            })

          if (assistError) throw assistError
        }
      }

      // Update team scores
      for (const team of teams) {
        const teamGoalCount = goals.filter(g => g.team_id === team.id).length

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: scoreError } = await (supabase as any)
          .from('teams')
          .update({ score: teamGoalCount })
          .eq('id', team.id)

        if (scoreError) throw scoreError
      }

      // Call finalize_match_results RPC
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcError } = await (supabase as any)
        .rpc('finalize_match_results', { p_match_id: matchId })

      if (rpcError) throw rpcError

      setFinalized(true)
      router.refresh()
    } catch (err) {
      console.error('Error saving results:', err)
      alert('Error al guardar los resultados')
    } finally {
      setSaving(false)
    }
  }

  if (finalized) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Goal className="h-8 w-8 mx-auto mb-3 text-green-500" />
          <p className="font-medium">Resultados guardados</p>
          <p className="text-sm text-muted-foreground mt-1">
            {resultsFinalized
              ? 'Los goles fueron actualizados.'
              : 'Las estadísticas de los jugadores fueron actualizadas.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const renderTeamSection = (team: TeamData) => {
    const teamGoals = getTeamGoals(team.id)
    const teamLabel = team.name === 'dark' ? 'Oscuro' : 'Claro'

    return (
      <div key={team.id} className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-full border"
              style={{ backgroundColor: team.color_hex }}
            />
            <span className="font-medium">{teamLabel}</span>
            <span className="text-2xl font-bold">{teamGoals.length}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => addGoal(team.id)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Gol
          </Button>
        </div>

        {teamGoals.map((goal) => {
          const globalIndex = goals.indexOf(goal)
          return (
            <div key={globalIndex} className="flex items-start gap-2 pl-6">
              <div className="flex-1 space-y-2">
                <select
                  value={goal.scorer_id}
                  onChange={(e) => updateGoalScorer(globalIndex, e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Seleccionar goleador...</option>
                  {team.players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name}
                    </option>
                  ))}
                </select>
                <select
                  value={goal.assister_id || ''}
                  onChange={(e) => updateGoalAssister(globalIndex, e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Asistencia (opcional)</option>
                  {team.players
                    .filter((p) => p.id !== goal.scorer_id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name}
                      </option>
                    ))}
                </select>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeGoal(globalIndex)}
                className="text-destructive hover:text-destructive mt-1"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Goal className="h-5 w-5" />
          Cargar resultado
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Score overview */}
        <div className="flex items-center justify-center gap-6 text-center">
          <div>
            <div
              className="w-6 h-6 rounded-full border mx-auto mb-1"
              style={{ backgroundColor: darkTeam.color_hex }}
            />
            <span className="text-sm text-muted-foreground">Oscuro</span>
            <p className="text-3xl font-bold">{getTeamGoals(darkTeam.id).length}</p>
          </div>
          <span className="text-2xl text-muted-foreground font-light">—</span>
          <div>
            <div
              className="w-6 h-6 rounded-full border mx-auto mb-1"
              style={{ backgroundColor: lightTeam.color_hex }}
            />
            <span className="text-sm text-muted-foreground">Claro</span>
            <p className="text-3xl font-bold">{getTeamGoals(lightTeam.id).length}</p>
          </div>
        </div>

        <div className="border-t pt-4 space-y-6">
          {renderTeamSection(darkTeam)}
          {renderTeamSection(lightTeam)}
        </div>

        <Button
          onClick={handleSave}
          disabled={saving}
          className="w-full"
        >
          {saving ? (
            <Spinner size="sm" className="mr-2" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {resultsFinalized ? 'Actualizar goles' : 'Guardar resultados'}
        </Button>
        {resultsFinalized && (
          <p className="text-xs text-muted-foreground text-center">
            Las estadísticas ya fueron contabilizadas. Podés corregir los goles sin duplicar stats.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
