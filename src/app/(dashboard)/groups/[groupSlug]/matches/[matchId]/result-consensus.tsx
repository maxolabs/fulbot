import { Goal, Trophy, Lock, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { MatchResultStatus } from '@/types/database'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'

// Result block shown to every member of a finished match. It renders the
// consensus (or admin-locked) result that lives in teams.score / match_events /
// matches.mvp_player_id, plus how many players contributed. It is a server
// component: whether it's rendered at all is decided by the page (blind rule --
// a player who can still report never sees it before their own report exists).

export interface ConsensusTeam {
  id: string
  name: 'dark' | 'light'
  color_hex: string
  score: number
}

export interface ConsensusEvent {
  id: string
  team_id: string
  player_id: string | null
  guest_player_id: string | null
  event_type: string
  player_name: string | null
}

interface ResultConsensusProps {
  teams: ConsensusTeam[]
  events: ConsensusEvent[]
  resultStatus: MatchResultStatus
  reportersCount: number
  playersCount: number
  mvpName: string | null
  language: Language
}

const STATUS_VARIANT: Record<MatchResultStatus, 'outline' | 'success' | 'secondary' | 'warning'> = {
  pending: 'outline',
  provisional: 'warning',
  consensus: 'success',
  locked: 'secondary',
}

interface PlayerLine {
  key: string
  name: string
  goals: number
  assists: number
}

function groupTeamEvents(events: ConsensusEvent[], teamId: string, fallbackName: string) {
  const byPlayer = new Map<string, PlayerLine>()
  let unattributed = 0

  for (const e of events) {
    if (e.team_id !== teamId) continue
    if (e.event_type !== 'goal' && e.event_type !== 'assist') continue
    const key = e.player_id || e.guest_player_id
    if (!key) {
      if (e.event_type === 'goal') unattributed += 1
      continue
    }
    const line = byPlayer.get(key) || { key, name: e.player_name || fallbackName, goals: 0, assists: 0 }
    if (e.event_type === 'goal') line.goals += 1
    else line.assists += 1
    byPlayer.set(key, line)
  }

  const lines = Array.from(byPlayer.values()).sort(
    (a, b) => b.goals - a.goals || b.assists - a.assists || a.name.localeCompare(b.name)
  )
  return { lines, unattributed }
}

export function ResultConsensus({
  teams,
  events,
  resultStatus,
  reportersCount,
  playersCount,
  mvpName,
  language,
}: ResultConsensusProps) {
  const tr = getT(language)
  const darkTeam = teams.find(t => t.name === 'dark')
  const lightTeam = teams.find(t => t.name === 'light')

  if (!darkTeam || !lightTeam) return null
  if (resultStatus === 'pending') return null

  const teamLabel = (name: ConsensusTeam['name']) => tr(`ui.matchScreens.dashboard.${name}`)
  const grouped = [darkTeam, lightTeam].map(team => ({ team, ...groupTeamEvents(events, team.id, tr('ui.result.player')) }))
  const hasDetails = grouped.some(g => g.lines.length > 0 || g.unattributed > 0)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Goal className="h-5 w-5" />
            {tr('ui.result.title')}
          </CardTitle>
          <Badge variant={STATUS_VARIANT[resultStatus]} className="flex items-center gap-1">
            {resultStatus === 'locked' && <Lock className="h-3 w-3" />}
            {tr(`ui.result.badge.${resultStatus}`)}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
          <Users className="h-3.5 w-3.5" />
          {resultStatus === 'locked'
            ? tr('ui.result.lockedReporters', { n: reportersCount, total: playersCount })
            : tr('ui.result.reporters', { n: reportersCount, total: playersCount })}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-center gap-6 text-center">
          <div>
            <div className="w-6 h-6 rounded-full border mx-auto mb-1" style={{ backgroundColor: darkTeam.color_hex }} />
            <span className="text-sm text-muted-foreground">{teamLabel('dark')}</span>
            <p className="text-3xl font-bold">{darkTeam.score}</p>
          </div>
          <span className="text-2xl text-muted-foreground font-light">—</span>
          <div>
            <div className="w-6 h-6 rounded-full border mx-auto mb-1" style={{ backgroundColor: lightTeam.color_hex }} />
            <span className="text-sm text-muted-foreground">{teamLabel('light')}</span>
            <p className="text-3xl font-bold">{lightTeam.score}</p>
          </div>
        </div>

        {hasDetails && (
          <div className="border-t pt-3 grid gap-4 sm:grid-cols-2">
            {grouped.map(({ team, lines, unattributed }) => (
              <div key={team.id} className="space-y-1">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded-full border" style={{ backgroundColor: team.color_hex }} />
                  <span className="text-sm font-medium text-muted-foreground">
                    {teamLabel(team.name)}
                  </span>
                </div>
                {lines.length === 0 && unattributed === 0 && (
                  <p className="text-sm text-muted-foreground pl-5">{tr('ui.result.noGoals')}</p>
                )}
                {lines.map(line => (
                  <div key={line.key} className="flex items-center gap-2 pl-5 text-sm">
                    <span className="font-medium">{line.name}</span>
                    <span className="text-muted-foreground">
                      {line.goals > 0 && `${'⚽'.repeat(Math.min(line.goals, 5))}${line.goals > 5 ? ` ×${line.goals}` : ''}`}
                      {line.goals > 0 && line.assists > 0 && ' · '}
                      {line.assists > 0 && tr('ui.result.assists', { n: line.assists })}
                    </span>
                  </div>
                ))}
                {unattributed > 0 && (
                  <p className="text-sm text-muted-foreground pl-5 italic">
                    {unattributed === 1 ? tr('ui.result.unattributedOne') : tr('ui.result.unattributedMany', { n: unattributed })}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {mvpName && (
          <p className="border-t pt-3 flex items-center gap-1.5 text-sm text-warning">
            <Trophy className="h-4 w-4" />
            {tr('ui.result.mvp', { name: mvpName })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
