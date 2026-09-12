'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Bot, Calculator, Check, CircleAlert, Copy, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Pitch, type PitchPlayer } from '@/components/ui/pitch'
import { PlayerRow } from '@/components/ui/player-row'
import { PageHeader } from '@/components/layout/page-header'
import { ActionBar } from '@/components/layout/action-bar'
import { getFormationSlots, placePlayersInFormation, type PlacedPlayer } from '@/lib/formations'
import { TEAM_DARK, TEAM_LIGHT, TEAM_LIGHT_INK } from '@/lib/brand'
import { useLanguage, useT } from '@/i18n/provider'
import { cn } from '@/lib/utils/cn'
import { DraggableTeams } from './draggable-teams'
import { WhatsAppShare, generateShareMessage, shareName } from './whatsapp-share'

// Teams screen (docs/ui-rework/03-screens.md §4). Browser: PageHeader, two
// dashed cards with one Pitch each, then the analysis and warnings cards.
// Mobile: two team tiles over ONE combined Pitch (the screenshot people send,
// so it fits a phone screen without scrolling; ratings hidden there,
// 06-principles.md §1.4), ActionBar with "Enviar al grupo" as the one primary.
// The draggable editor is a separate mode: it replaces the pitches in the
// browser and appears below the combined pitch on mobile.

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

type TeamPlayer = Player & {
  position: string
  assignmentId: string
  playerId: string | null
  guestPlayerId: string | null
}

interface TeamsViewProps {
  matchId: string
  groupName: string
  /** "Lunes 14/9 · 20:00", formatted on the server in the group's timezone. */
  dateLabel: string
  /** "Lunes 14/9 - 20:00", the share text's date line. */
  shareDateLabel: string
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
  provider?: 'openai' | 'fallback'
  isAdminOrCaptain: boolean
  hasTeams: boolean
  matchStatus?: string
}

// "1-3-2-1": players per line from the keeper up, read off the formation
// slots so the badge always matches what the pitch draws.
function formationShape(size: number): string {
  const lines = new Map<number, number>()
  for (const slot of getFormationSlots(size)) lines.set(slot.y, (lines.get(slot.y) ?? 0) + 1)
  return Array.from(lines.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([, count]) => count)
    .join('-')
}

function toPitchPlayers(list: TeamPlayer[]): PlacedPlayer<PitchPlayer>[] {
  return placePlayersInFormation(
    list.map((p) => ({ id: p.id, name: shareName(p), position: p.position, rating: p.overallRating }))
  )
}

function average(list: TeamPlayer[]): number {
  return list.length > 0 ? list.reduce((sum, p) => sum + p.overallRating, 0) / list.length : 0
}

export function TeamsView({
  matchId,
  groupName,
  dateLabel,
  shareDateLabel,
  players,
  darkTeam,
  lightTeam,
  aiReasoning,
  balanceScore,
  warnings,
  provider,
  isAdminOrCaptain,
  hasTeams,
  matchStatus,
}: TeamsViewProps) {
  const t = useT()
  const language = useLanguage()
  const router = useRouter()
  const canEditTeams = isAdminOrCaptain && matchStatus !== 'finished' && matchStatus !== 'cancelled'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)

  const handleGenerateTeams = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/matches/${matchId}/teams/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || t('ui.teamsScreen.generateError'))
      setEditing(false)
      router.refresh()
    } catch (err) {
      console.error('Error generating teams:', err)
      setError(err instanceof Error ? err.message : t('ui.teamsScreen.generateError'))
    } finally {
      setLoading(false)
    }
  }

  // Players by team (matched by player_id or guest_player_id), carrying both ids
  // through so manual edits (drag/drop, position changes) can be saved via
  // save_team_assignments without losing track of whether it's a player or a guest.
  const resolve = (assignments: Assignment[]): TeamPlayer[] =>
    assignments
      .map((a) => {
        const id = a.player_id || a.guest_player_id
        const player = players.find((p) => p.id === id)
        if (!player) return null
        return {
          ...player,
          position: a.position,
          assignmentId: a.id,
          playerId: a.player_id,
          guestPlayerId: a.guest_player_id,
        }
      })
      .filter((p): p is TeamPlayer => p !== null)

  const darkPlayers = resolve(darkTeam.assignments)
  const lightPlayers = resolve(lightTeam.assignments)
  const darkPlaced = toPitchPlayers(darkPlayers)
  const lightPlaced = toPitchPlayers(lightPlayers)

  const assignedIds = new Set([
    ...darkTeam.assignments.map((a) => a.player_id || a.guest_player_id),
    ...lightTeam.assignments.map((a) => a.player_id || a.guest_player_id),
  ])
  const unassignedPlayers = players.filter((p) => !assignedIds.has(p.id))

  const darkShape = formationShape(darkPlayers.length)
  const lightShape = formationShape(lightPlayers.length)
  const shape = darkShape === lightShape ? darkShape : `${darkShape} / ${lightShape}`
  const teamNames = { dark: t('ui.teamsScreen.dark'), light: t('ui.teamsScreen.light') }
  const countLabel = (n: number) =>
    n === 1 ? t('ui.teamsScreen.playersOne') : t('ui.teamsScreen.players', { n })
  const levelLabel = (list: TeamPlayer[]) => t('ui.teamsScreen.level', { n: average(list).toFixed(1) })

  const shareInput = { groupName, dateLabel: shareDateLabel, darkPlayers, lightPlayers }

  const copySimple = async () => {
    try {
      await navigator.clipboard.writeText(generateShareMessage('simple', shareInput))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const toggleEditor = () => {
    const next = !editing
    setEditing(next)
    if (next) {
      // The editor mounts below the combined pitch on mobile; bring it into view.
      requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }

  const generateButton = (size: 'default' | 'xl', variant: 'default' | 'outline') => (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={handleGenerateTeams}
      disabled={loading || players.length < 4}
    >
      {loading ? <Spinner size="sm" /> : <Sparkles className="h-4 w-4" strokeWidth={1.75} />}
      {loading
        ? t('ui.teamsScreen.generating')
        : hasTeams
          ? t('ui.teamsScreen.regenerate')
          : t('ui.teamsScreen.generate')}
    </Button>
  )

  const editButton = (size: 'default' | 'xl') => (
    <Button type="button" size={size} variant="outline" onClick={toggleEditor} aria-pressed={editing}>
      {editing ? t('ui.teamsScreen.viewPitch') : t('ui.teamsScreen.edit')}
    </Button>
  )

  const formationBadge = <Badge variant="outline">{t('ui.teamsScreen.formation', { shape })}</Badge>

  // One orange per screen: while the editor is open its "Guardar cambios" is
  // the primary, so "Enviar al grupo" steps down to a chalk outline.
  const sendButton = (size: 'default' | 'xl') => (
    <Button type="button" size={size} variant={editing ? 'outline' : 'default'} onClick={() => setShareOpen(true)}>
      {t('ui.teamsScreen.send')}
    </Button>
  )

  return (
    <div className="space-y-6">
      {/* The subtitle is a <p>, so the formation Badge (a div) sits in the actions slot. */}
      <PageHeader
        title={t('ui.teamsScreen.title')}
        subtitle={<span className="font-mono">{dateLabel}</span>}
        actions={
          hasTeams ? (
            <>
              <span className="mr-2">{formationBadge}</span>
              {canEditTeams && editButton('default')}
              {sendButton('default')}
            </>
          ) : canEditTeams ? (
            generateButton('default', 'default')
          ) : undefined
        }
      />

      {/* Mobile hero line: the top bar carries the title. */}
      <div className="flex items-center justify-between gap-3 lg:hidden">
        <p className="font-mono text-xs text-muted-foreground">{dateLabel}</p>
        {hasTeams && formationBadge}
      </div>

      {error && (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <CircleAlert className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {error}
        </p>
      )}

      {canEditTeams && players.length < 4 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" strokeWidth={1.75} />
          {t('ui.teamsScreen.needPlayers', { n: players.length })}
        </p>
      )}

      {hasTeams ? (
        <>
          {/* Mobile: tiles + one combined pitch. Always visible; the editor goes below. */}
          <div className="space-y-2 lg:hidden">
            <div className="grid grid-cols-2 gap-2">
              <div
                className="flex h-14 flex-col justify-center rounded-md px-3"
                style={{ backgroundColor: TEAM_DARK, color: TEAM_LIGHT }}
              >
                <span className="font-display text-sm font-bold leading-tight">{teamNames.dark}</span>
                <span className="whitespace-nowrap font-mono text-[10px] leading-tight tabular-nums">
                  {isAdminOrCaptain && `${levelLabel(darkPlayers)} · `}
                  {countLabel(darkPlayers.length)}
                </span>
              </div>
              <div
                className="flex h-14 flex-col justify-center rounded-md px-3"
                style={{ backgroundColor: TEAM_LIGHT, color: TEAM_LIGHT_INK }}
              >
                <span className="font-display text-sm font-bold leading-tight">{teamNames.light}</span>
                <span className="whitespace-nowrap font-mono text-[10px] leading-tight tabular-nums">
                  {isAdminOrCaptain && `${levelLabel(lightPlayers)} · `}
                  {countLabel(lightPlayers.length)}
                </span>
              </div>
            </div>
            <Pitch
              both={{ dark: darkPlaced, light: lightPlaced }}
              labels="name"
              teamNames={teamNames}
              emptyLabel={t('ui.teamsScreen.empty')}
            />
          </div>

          {/* Browser: one dashed card per team. Hidden while the editor is open. */}
          <div className={cn('hidden gap-6 lg:grid lg:grid-cols-2', editing && 'lg:hidden')}>
            {(['dark', 'light'] as const).map((team) => {
              const list = team === 'dark' ? darkPlayers : lightPlayers
              const placed = team === 'dark' ? darkPlaced : lightPlaced
              return (
                <Card key={team}>
                  <CardHeader className="flex-row items-baseline justify-between space-y-0">
                    <CardTitle className="text-lg">{teamNames[team]}</CardTitle>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {isAdminOrCaptain && `${levelLabel(list)} · `}
                      {countLabel(list.length)}
                    </span>
                  </CardHeader>
                  <CardContent>
                    <Pitch
                      players={placed}
                      team={team}
                      showRatings={isAdminOrCaptain}
                      labels="both"
                      teamNames={teamNames}
                      emptyLabel={t('ui.teamsScreen.empty')}
                    />
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {editing && canEditTeams && (
            <div ref={editorRef} className="scroll-mt-16">
              <DraggableTeams
                matchId={matchId}
                darkTeamId={darkTeam.id!}
                lightTeamId={lightTeam.id!}
                darkPlayers={darkPlayers}
                lightPlayers={lightPlayers}
                isAdminOrCaptain={isAdminOrCaptain}
                onUpdate={() => router.refresh()}
              />
            </div>
          )}

          {unassignedPlayers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('ui.teamsScreen.unassigned')}{' '}
                  <span className="font-mono text-sm font-normal text-muted-foreground">
                    {unassignedPlayers.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {unassignedPlayers.map((player) => (
                  <Badge key={player.id} variant="outline">
                    {player.displayName}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0">
            <CardTitle>{t('ui.teamsScreen.available')}</CardTitle>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {countLabel(players.length)}
            </span>
          </CardHeader>
          <CardContent>
            <ol className="[&>li:last-child>*]:border-b-0">
              {players.map((player, i) => (
                <li key={player.id}>
                  <PlayerRow
                    index={i + 1}
                    name={player.displayName}
                    nickname={player.nickname}
                    position={player.mainPosition}
                    guest={player.isGuest}
                    language={language}
                    trailing={
                      isAdminOrCaptain ? (
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                          {player.overallRating.toFixed(1)}
                        </span>
                      ) : undefined
                    }
                  />
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {aiReasoning && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" strokeWidth={1.75} />
              {t('ui.teamsScreen.analysis')}
            </CardTitle>
            {provider && (
              <Badge variant="secondary" className="gap-1">
                {provider === 'openai' ? (
                  <Bot className="h-3 w-3" strokeWidth={1.75} />
                ) : (
                  <Calculator className="h-3 w-3" strokeWidth={1.75} />
                )}
                {provider === 'openai' ? t('ui.teamsScreen.ai') : t('ui.teamsScreen.deterministic')}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-pretty text-muted-foreground">{aiReasoning}</p>
            {balanceScore !== undefined && (
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">
                  {t('ui.teamsScreen.balance')}
                </span>
                <div className="h-1.5 max-w-[200px] flex-1 rounded-sm bg-muted">
                  <div className="h-full rounded-sm bg-success" style={{ width: `${balanceScore * 100}%` }} />
                </div>
                <span className="font-mono text-sm tabular-nums">{Math.round(balanceScore * 100)}%</span>
              </div>
            )}
            {canEditTeams && (
              <div className="border-t border-border pt-3">
                <p className="mb-2 text-xs text-muted-foreground">{t('ui.teamsScreen.generateHint')}</p>
                {generateButton('default', 'outline')}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {warnings && warnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" strokeWidth={1.75} />
              {t('ui.teamsScreen.warnings')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {warnings.map((warning, i) => (
                <li key={i} className="text-sm text-pretty text-muted-foreground">
                  {warning}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {hasTeams && (
        <WhatsAppShare open={shareOpen} onOpenChange={setShareOpen} {...shareInput} />
      )}

      {hasTeams ? (
        <ActionBar>
          {sendButton('xl')}
          {canEditTeams ? (
            editButton('xl')
          ) : (
            <Button type="button" size="xl" variant="outline" onClick={copySimple}>
              {copied ? (
                <Check className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <Copy className="h-4 w-4" strokeWidth={1.75} />
              )}
              {copied ? t('ui.teamsScreen.copied') : t('ui.teamsScreen.copy')}
            </Button>
          )}
        </ActionBar>
      ) : canEditTeams ? (
        <ActionBar>{generateButton('xl', 'default')}</ActionBar>
      ) : null}
    </div>
  )
}
