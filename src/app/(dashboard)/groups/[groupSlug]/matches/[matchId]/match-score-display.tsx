'use client'

import { Goal } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface TeamScore {
  id: string
  name: 'dark' | 'light'
  color_hex: string
  score: number
}

interface GoalDetail {
  id: string
  team_id: string
  scorer_name: string
  assister_name: string | null
  event_type: string
}

interface MatchScoreDisplayProps {
  teams: TeamScore[]
  goals: GoalDetail[]
}

export function MatchScoreDisplay({ teams, goals }: MatchScoreDisplayProps) {
  const darkTeam = teams.find(t => t.name === 'dark')
  const lightTeam = teams.find(t => t.name === 'light')

  if (!darkTeam || !lightTeam) return null

  // If no results recorded yet
  if (goals.length === 0 && darkTeam.score === 0 && lightTeam.score === 0) {
    return null
  }

  const getTeamGoals = (teamId: string) => goals.filter(g => g.team_id === teamId && g.event_type === 'goal')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Goal className="h-5 w-5" />
          Resultado
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Score */}
        <div className="flex items-center justify-center gap-6 text-center">
          <div>
            <div
              className="w-6 h-6 rounded-full border mx-auto mb-1"
              style={{ backgroundColor: darkTeam.color_hex }}
            />
            <span className="text-sm text-muted-foreground">Oscuro</span>
            <p className="text-3xl font-bold">{darkTeam.score}</p>
          </div>
          <span className="text-2xl text-muted-foreground font-light">—</span>
          <div>
            <div
              className="w-6 h-6 rounded-full border mx-auto mb-1"
              style={{ backgroundColor: lightTeam.color_hex }}
            />
            <span className="text-sm text-muted-foreground">Claro</span>
            <p className="text-3xl font-bold">{lightTeam.score}</p>
          </div>
        </div>

        {/* Goal details */}
        {goals.length > 0 && (
          <div className="border-t pt-3 space-y-4">
            {[darkTeam, lightTeam].map(team => {
              const teamGoals = getTeamGoals(team.id)
              if (teamGoals.length === 0) return null
              const teamLabel = team.name === 'dark' ? 'Oscuro' : 'Claro'

              return (
                <div key={team.id} className="space-y-1">
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-3 h-3 rounded-full border"
                      style={{ backgroundColor: team.color_hex }}
                    />
                    <span className="text-sm font-medium text-muted-foreground">{teamLabel}</span>
                  </div>
                  {teamGoals.map(goal => (
                    <div key={goal.id} className="flex items-center gap-2 pl-5 text-sm">
                      <span>⚽</span>
                      <span className="font-medium">{goal.scorer_name}</span>
                      {goal.assister_name && (
                        <span className="text-muted-foreground">
                          (asist. {goal.assister_name})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
