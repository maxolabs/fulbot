'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Star, Save, ArrowLeftRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import { TEAM_DARK, TEAM_LIGHT, TEAM_LIGHT_INK } from '@/lib/brand'
import { useT } from '@/i18n/provider'
import type { Json } from '@/types/database'

// Pizarra pass (docs/ui-rework/05-plan.md §4): tokens only, no redesign. Team
// identity lives in the card headers (fixed team colours from brand.ts); the
// rows themselves are plain surfaces so the controls keep their token styles.

// Standard position abbreviations used across the app (AI prompt, fallback balancer, lineup field)
export const POSITION_OPTIONS = [
  'GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF',
] as const

interface Player {
  id: string // player_profiles.id or guest_players.id - stable key across drag/drop
  playerId: string | null
  guestPlayerId: string | null
  displayName: string
  nickname: string | null
  mainPosition: string
  overallRating: number
  position: string
  assignmentId: string
}

interface DraggableTeamsProps {
  matchId: string
  darkTeamId: string
  lightTeamId: string
  darkPlayers: Player[]
  lightPlayers: Player[]
  isAdminOrCaptain: boolean
  onUpdate: () => void
}

interface SortablePlayerProps {
  player: Player
  teamColor: 'dark' | 'light'
  onMoveTeam: () => void
  onPositionChange: (position: string) => void
}

function SortablePlayer({ player, teamColor, onMoveTeam, onPositionChange }: SortablePlayerProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: player.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const isDark = teamColor === 'dark'
  const t = useT()

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex flex-wrap items-center gap-2 sm:gap-3 p-3 rounded-md border border-border bg-card text-card-foreground ${
        isDragging ? 'z-50' : ''
      }`}
    >
      <button
        className="cursor-grab touch-none shrink-0 rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        {...attributes}
        {...listeners}
        aria-label="Arrastrar jugador"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
      </button>

      <Avatar fallback={player.displayName} size="sm" />

      <div className="flex-1 min-w-[120px]">
        <p className="text-sm font-medium truncate">
          {player.displayName}
          {player.nickname && (
            <span className="ml-1 text-muted-foreground">
              ({player.nickname})
            </span>
          )}
        </p>
        <p className="text-xs flex items-center gap-1 font-mono tabular-nums text-muted-foreground">
          <Star className="h-3 w-3 text-primary fill-primary" strokeWidth={1.75} />
          {player.overallRating.toFixed(1)}
        </p>
      </div>

      <select
        value={player.position}
        onChange={(e) => onPositionChange(e.target.value)}
        aria-label="Posición"
        className="h-9 rounded-[3px] border border-border bg-background px-2 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {POSITION_OPTIONS.map((pos) => (
          <option key={pos} value={pos}>{pos}</option>
        ))}
      </select>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onMoveTeam}
        className="h-9 text-xs shrink-0"
      >
        <ArrowLeftRight className="h-3 w-3" strokeWidth={1.75} />
        {isDark ? `→ ${t('ui.teamsScreen.light')}` : `→ ${t('ui.teamsScreen.dark')}`}
      </Button>
    </div>
  )
}

function PlayerOverlay({ player }: { player: Player }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-md border border-primary bg-card text-card-foreground shadow-lg shadow-black/40">
      <GripVertical className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
      <Badge variant="outline" className="font-mono text-xs">
        {player.position}
      </Badge>
      <Avatar fallback={player.displayName} size="sm" />
      <span className="text-sm font-medium">{player.displayName}</span>
    </div>
  )
}

export function DraggableTeams({
  matchId,
  darkTeamId,
  lightTeamId,
  darkPlayers: initialDarkPlayers,
  lightPlayers: initialLightPlayers,
  isAdminOrCaptain,
  onUpdate,
}: DraggableTeamsProps) {
  const router = useRouter()
  const supabase = createClient()
  const t = useT()

  const [darkPlayers, setDarkPlayers] = useState(initialDarkPlayers)
  const [lightPlayers, setLightPlayers] = useState(initialLightPlayers)
  const [activePlayer, setActivePlayer] = useState<Player | null>(null)
  const [hasChanges, setHasChanges] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const player =
      darkPlayers.find((p) => p.id === active.id) ||
      lightPlayers.find((p) => p.id === active.id)
    setActivePlayer(player || null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActivePlayer(null)

    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string

    // Find which team the active player is in
    const isActiveInDark = darkPlayers.some((p) => p.id === activeId)
    const isActiveInLight = lightPlayers.some((p) => p.id === activeId)

    // Find which team the over target is in (or is the team container)
    const isOverDark = overId === 'dark-team' || darkPlayers.some((p) => p.id === overId)
    const isOverLight = overId === 'light-team' || lightPlayers.some((p) => p.id === overId)

    // Moving between teams
    if (isActiveInDark && isOverLight) {
      const player = darkPlayers.find((p) => p.id === activeId)!
      setDarkPlayers(darkPlayers.filter((p) => p.id !== activeId))
      setLightPlayers([...lightPlayers, player])
      setHasChanges(true)
    } else if (isActiveInLight && isOverDark) {
      const player = lightPlayers.find((p) => p.id === activeId)!
      setLightPlayers(lightPlayers.filter((p) => p.id !== activeId))
      setDarkPlayers([...darkPlayers, player])
      setHasChanges(true)
    }
  }

  // Touch-friendly fallback for drag and drop: move a player with a button tap
  const moveToTeam = (playerId: string, from: 'dark' | 'light') => {
    if (from === 'dark') {
      const player = darkPlayers.find((p) => p.id === playerId)
      if (!player) return
      setDarkPlayers(darkPlayers.filter((p) => p.id !== playerId))
      setLightPlayers([...lightPlayers, player])
    } else {
      const player = lightPlayers.find((p) => p.id === playerId)
      if (!player) return
      setLightPlayers(lightPlayers.filter((p) => p.id !== playerId))
      setDarkPlayers([...darkPlayers, player])
    }
    setHasChanges(true)
  }

  const changePosition = (playerId: string, team: 'dark' | 'light', position: string) => {
    const updater = (list: Player[]) => list.map((p) => (p.id === playerId ? { ...p, position } : p))
    if (team === 'dark') setDarkPlayers(updater(darkPlayers))
    else setLightPlayers(updater(lightPlayers))
    setHasChanges(true)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)

    try {
      const assignments = [
        ...darkPlayers.map((p, i) => ({
          team: 'dark' as const,
          player_id: p.playerId,
          guest_player_id: p.guestPlayerId,
          position: p.position,
          order_index: i,
        })),
        ...lightPlayers.map((p, i) => ({
          team: 'light' as const,
          player_id: p.playerId,
          guest_player_id: p.guestPlayerId,
          position: p.position,
          order_index: i,
        })),
      ]

      const { error: saveError } = await supabase.rpc('save_team_assignments', {
        p_match_id: matchId,
        p_assignments: assignments as unknown as Json,
      })

      if (saveError) throw saveError

      setHasChanges(false)
      onUpdate()
      router.refresh()
    } catch (err) {
      console.error('Error saving teams:', err)
      setError('No se pudieron guardar los cambios. Probá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  // Calculate team stats
  const darkAvg = darkPlayers.length > 0
    ? darkPlayers.reduce((sum, p) => sum + p.overallRating, 0) / darkPlayers.length
    : 0
  const lightAvg = lightPlayers.length > 0
    ? lightPlayers.reduce((sum, p) => sum + p.overallRating, 0) / lightPlayers.length
    : 0

  if (!isAdminOrCaptain) {
    return null
  }

  const teamHeader = (team: 'dark' | 'light', count: number, avg: number) => (
    <CardHeader
      className="flex-row items-baseline justify-between space-y-0 rounded-t-md py-3 lg:py-3"
      style={
        team === 'dark'
          ? { backgroundColor: TEAM_DARK, color: TEAM_LIGHT }
          : { backgroundColor: TEAM_LIGHT, color: TEAM_LIGHT_INK }
      }
    >
      <CardTitle className="text-base">{t(`ui.teamsScreen.${team}`)}</CardTitle>
      <span className="font-mono text-xs tabular-nums">
        {t('ui.teamsScreen.level', { n: avg.toFixed(1) })} · {count}
      </span>
    </CardHeader>
  )

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Save button */}
      {hasChanges && (
        <Card variant="solid" className="border-primary">
          <CardContent className="py-3 lg:py-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <p className="text-sm">Hay cambios sin guardar</p>
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? (
                  <Spinner size="sm" />
                ) : (
                  <Save className="h-4 w-4" strokeWidth={1.75} />
                )}
                Guardar cambios
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Dark Team */}
          <Card variant="solid">
            {teamHeader('dark', darkPlayers.length, darkAvg)}
            <CardContent className="pt-4 lg:pt-4" id="dark-team">
              <SortableContext
                items={darkPlayers.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2 min-h-[100px]">
                  {darkPlayers.map((player) => (
                    <SortablePlayer
                      key={player.id}
                      player={player}
                      teamColor="dark"
                      onMoveTeam={() => moveToTeam(player.id, 'dark')}
                      onPositionChange={(position) => changePosition(player.id, 'dark', position)}
                    />
                  ))}
                  {darkPlayers.length === 0 && (
                    <p className="text-center text-sm text-muted-foreground py-8">
                      Arrastra jugadores aquí
                    </p>
                  )}
                </div>
              </SortableContext>
            </CardContent>
          </Card>

          {/* Light Team */}
          <Card variant="solid">
            {teamHeader('light', lightPlayers.length, lightAvg)}
            <CardContent className="pt-4 lg:pt-4" id="light-team">
              <SortableContext
                items={lightPlayers.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2 min-h-[100px]">
                  {lightPlayers.map((player) => (
                    <SortablePlayer
                      key={player.id}
                      player={player}
                      teamColor="light"
                      onMoveTeam={() => moveToTeam(player.id, 'light')}
                      onPositionChange={(position) => changePosition(player.id, 'light', position)}
                    />
                  ))}
                  {lightPlayers.length === 0 && (
                    <p className="text-center text-sm text-muted-foreground py-8">
                      Arrastra jugadores aquí
                    </p>
                  )}
                </div>
              </SortableContext>
            </CardContent>
          </Card>
        </div>

        <DragOverlay>
          {activePlayer && <PlayerOverlay player={activePlayer} />}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
