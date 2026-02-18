'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, RefreshCw, Users, AlertTriangle, LayoutGrid, List } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Avatar } from '@/components/ui/avatar'
import { LineupField } from './lineup-field'
import { DraggableTeams } from './draggable-teams'
import { WhatsAppShare } from './whatsapp-share'

interface Player {
  id: string
  displayName: string
  nickname: string | null
  mainPosition: string
  overallRating: number
  isGuest?: boolean
}

interface Assignment {
  id: string
  team_id: string
  player_id: string | null
  guest_player_id: string | null
  position: string
  order_index: number
}

interface TeamsViewProps {
  matchId: string
  groupSlug: string
  groupName: string
  matchDate: Date
  players: Player[]
  darkTeam: {
    id: string | null
    assignments: Assignment[]
  }
  lightTeam: {
    id: string | null
    assignments: Assignment[]
  }
  aiReasoning?: string
  balanceScore?: number
  warnings?: string[]
  isAdminOrCaptain: boolean
  hasTeams: boolean
}

export function TeamsView({
  matchId,
  groupSlug,
  groupName,
  matchDate,
  players,
  darkTeam,
  lightTeam,
  aiReasoning,
  balanceScore,
  warnings,
  isAdminOrCaptain,
  hasTeams,
}: TeamsViewProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'field' | 'list'>('field')

  const handleGenerateTeams = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/matches/${matchId}/teams/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Error al generar equipos')
      }

      router.refresh()
    } catch (err) {
      console.error('Error generating teams:', err)
      setError(err instanceof Error ? err.message : 'Error al generar equipos')
    } finally {
      setLoading(false)
    }
  }

  // Get players by team (match by player_id or guest_player_id)
  const darkPlayers = darkTeam.assignments.map((a) => {
    const id = a.player_id || a.guest_player_id
    const player = players.find((p) => p.id === id)
    if (!player) return null
    return { ...player, position: a.position, assignmentId: a.id }
  }).filter(Boolean) as (Player & { position: string; assignmentId: string })[]

  const lightPlayers = lightTeam.assignments.map((a) => {
    const id = a.player_id || a.guest_player_id
    const player = players.find((p) => p.id === id)
    if (!player) return null
    return { ...player, position: a.position, assignmentId: a.id }
  }).filter(Boolean) as (Player & { position: string; assignmentId: string })[]

  // Calculate team stats
  const darkAvgRating = darkPlayers.length > 0
    ? darkPlayers.reduce((sum, p) => sum + p.overallRating, 0) / darkPlayers.length
    : 0

  const lightAvgRating = lightPlayers.length > 0
    ? lightPlayers.reduce((sum, p) => sum + p.overallRating, 0) / lightPlayers.length
    : 0

  // Get unassigned players
  const assignedIds = new Set([
    ...darkTeam.assignments.map((a) => a.player_id || a.guest_player_id),
    ...lightTeam.assignments.map((a) => a.player_id || a.guest_player_id),
  ])
  const unassignedPlayers = players.filter((p) => !assignedIds.has(p.id))

  return (
    <div className="space-y-6">
      {/* Error message */}
      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Generate button */}
      {isAdminOrCaptain && (
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">Generar equipos con IA</p>
                  <p className="text-sm text-muted-foreground">
                    La IA analiza jugadores y arma equipos equilibrados
                  </p>
                </div>
              </div>
              <Button onClick={handleGenerateTeams} disabled={loading || players.length < 4}>
                {loading ? (
                  <>
                    <Spinner size="sm" className="mr-2" />
                    Generando...
                  </>
                ) : hasTeams ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Regenerar equipos
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Generar equipos
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Not enough players warning */}
      {players.length < 4 && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              <p className="text-sm">
                Se necesitan al menos 4 jugadores confirmados para generar equipos.
                Actualmente hay {players.length}.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Reasoning */}
      {aiReasoning && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Análisis de la IA
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{aiReasoning}</p>
            {balanceScore !== undefined && (
              <div className="flex items-center gap-2 mt-3">
                <span className="text-sm">Balance:</span>
                <div className="flex-1 h-2 bg-muted rounded-full max-w-[200px]">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${balanceScore * 100}%` }}
                  />
                </div>
                <span className="text-sm font-medium">{Math.round(balanceScore * 100)}%</span>
              </div>
            )}
            {warnings && warnings.length > 0 && (
              <div className="mt-3 space-y-1">
                {warnings.map((warning, i) => (
                  <p key={i} className="text-sm text-yellow-600 flex items-center gap-2">
                    <AlertTriangle className="h-3 w-3" />
                    {warning}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Teams Display */}
      {hasTeams ? (
        <>
          {/* Controls: Share & View Toggle */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            {/* Share buttons */}
            <WhatsAppShare
              matchDate={matchDate}
              darkPlayers={darkPlayers}
              lightPlayers={lightPlayers}
              groupName={groupName}
            />

            {/* View Toggle */}
            {isAdminOrCaptain && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Vista:</span>
                <div className="flex border rounded-lg">
                  <button
                    onClick={() => setViewMode('field')}
                    className={`p-2 ${viewMode === 'field' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'} rounded-l-lg`}
                    title="Vista de cancha"
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`p-2 ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'} rounded-r-lg`}
                    title="Vista de lista (editable)"
                  >
                    <List className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {viewMode === 'field' ? (
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Dark Team */}
              <Card className="border-2 border-gray-800">
                <CardHeader className="bg-gray-800 text-white">
                  <CardTitle className="flex items-center justify-between">
                    <span>Equipo Oscuro</span>
                    <Badge variant="secondary" className="bg-white/20">
                      {darkPlayers.length} jugadores · {darkAvgRating.toFixed(1)} avg
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <LineupField
                    players={darkPlayers}
                    teamColor="dark"
                  />
                </CardContent>
              </Card>

              {/* Light Team */}
              <Card className="border-2 border-gray-300">
                <CardHeader className="bg-gray-100">
                  <CardTitle className="flex items-center justify-between">
                    <span>Equipo Claro</span>
                    <Badge variant="outline">
                      {lightPlayers.length} jugadores · {lightAvgRating.toFixed(1)} avg
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <LineupField
                    players={lightPlayers}
                    teamColor="light"
                  />
                </CardContent>
              </Card>
            </div>
          ) : (
            <DraggableTeams
              matchId={matchId}
              darkTeamId={darkTeam.id!}
              lightTeamId={lightTeam.id!}
              darkPlayers={darkPlayers}
              lightPlayers={lightPlayers}
              isAdminOrCaptain={isAdminOrCaptain}
              onUpdate={() => router.refresh()}
            />
          )}
        </>
      ) : (
        /* No teams yet - show player list */
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5" />
              Jugadores disponibles ({players.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {players.map((player) => (
                <div
                  key={player.id}
                  className="flex items-center gap-3 p-2 rounded-lg border"
                >
                  <Avatar fallback={player.displayName} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {player.displayName}
                      {player.nickname && (
                        <span className="text-muted-foreground ml-1">
                          ({player.nickname})
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {player.mainPosition} · {player.overallRating.toFixed(1)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Unassigned players (if any) */}
      {unassignedPlayers.length > 0 && hasTeams && (
        <Card className="border-yellow-500/30">
          <CardHeader>
            <CardTitle className="text-base text-yellow-700">
              Jugadores sin asignar ({unassignedPlayers.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {unassignedPlayers.map((player) => (
                <Badge key={player.id} variant="outline">
                  {player.displayName}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
