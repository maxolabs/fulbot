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
import { GripVertical, Star, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'

interface Player {
  id: string
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
}

function SortablePlayer({ player, teamColor }: SortablePlayerProps) {
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 rounded-lg border ${
        isDragging ? 'shadow-lg z-50' : ''
      } ${
        isDark
          ? 'bg-gray-800 text-white border-gray-700'
          : 'bg-white text-gray-800 border-gray-200'
      }`}
    >
      <button
        className="cursor-grab touch-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical className={`h-4 w-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} />
      </button>

      <Badge
        variant="outline"
        className={`font-mono text-xs ${
          isDark ? 'border-gray-600' : 'border-gray-300'
        }`}
      >
        {player.position}
      </Badge>

      <Avatar fallback={player.displayName} size="sm" />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {player.displayName}
          {player.nickname && (
            <span className={`ml-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              ({player.nickname})
            </span>
          )}
        </p>
        <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {player.mainPosition}
        </p>
      </div>

      <div className="flex items-center gap-1 text-xs">
        <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
        {player.overallRating.toFixed(1)}
      </div>
    </div>
  )
}

function PlayerOverlay({ player }: { player: Player }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-white shadow-xl border-primary">
      <GripVertical className="h-4 w-4 text-gray-500" />
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

  const [darkPlayers, setDarkPlayers] = useState(initialDarkPlayers)
  const [lightPlayers, setLightPlayers] = useState(initialLightPlayers)
  const [activePlayer, setActivePlayer] = useState<Player | null>(null)
  const [hasChanges, setHasChanges] = useState(false)
  const [saving, setSaving] = useState(false)

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

  const handleSave = async () => {
    setSaving(true)

    try {
      // Delete all existing assignments for both teams
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('team_assignments')
        .delete()
        .in('team_id', [darkTeamId, lightTeamId])

      // Insert new assignments for dark team
      if (darkPlayers.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from('team_assignments')
          .insert(
            darkPlayers.map((p, i) => ({
              team_id: darkTeamId,
              player_id: p.id,
              position: p.position,
              order_index: i,
              source: 'manual',
            }))
          )
      }

      // Insert new assignments for light team
      if (lightPlayers.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from('team_assignments')
          .insert(
            lightPlayers.map((p, i) => ({
              team_id: lightTeamId,
              player_id: p.id,
              position: p.position,
              order_index: i,
              source: 'manual',
            }))
          )
      }

      setHasChanges(false)
      onUpdate()
      router.refresh()
    } catch (err) {
      console.error('Error saving teams:', err)
      alert('Error al guardar los cambios')
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

  return (
    <div className="space-y-4">
      {/* Save button */}
      {hasChanges && (
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <p className="text-sm">Hay cambios sin guardar</p>
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? (
                  <Spinner size="sm" className="mr-2" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
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
          <Card className="border-2 border-gray-800">
            <CardHeader className="bg-gray-800 text-white py-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Equipo Oscuro</span>
                <Badge variant="secondary" className="bg-white/20">
                  {darkPlayers.length} · {darkAvg.toFixed(1)} avg
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4" id="dark-team">
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
          <Card className="border-2 border-gray-300">
            <CardHeader className="bg-gray-100 py-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Equipo Claro</span>
                <Badge variant="outline">
                  {lightPlayers.length} · {lightAvg.toFixed(1)} avg
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4" id="light-team">
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
