'use client'

import { useEffect, useState } from 'react'
import { ClipboardList, Check, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import type { MatchReport, MatchReportStat, MatchResultStatus } from '@/types/database'

interface MatchReportsTableProps {
  matchId: string
  resultStatus: MatchResultStatus
  teams: { id: string; name: 'dark' | 'light'; color_hex: string; score: number }[]
  /** Every name we might need: registered players by profile id and guests by guest id. */
  people: { id: string; display_name: string }[]
  /** Number of confirmed players (for "N de M reportaron"). */
  confirmedCount: number
}

type ReportRow = MatchReport & { match_report_stats: MatchReportStat[] }

function fmtStat(stats: MatchReportStat[], teamId: string, key: 'goals' | 'assists', name: (s: MatchReportStat) => string) {
  const items = stats
    .filter(s => s.team_id === teamId && s[key] > 0)
    .map(s => (s[key] > 1 ? `${name(s)} ×${s[key]}` : name(s)))
  return items.length > 0 ? items.join(', ') : '—'
}

export function MatchReportsTable({ matchId, resultStatus, teams, people, confirmedCount }: MatchReportsTableProps) {
  const supabase = createClient()
  const [reports, setReports] = useState<ReportRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // The Database type has no relationship metadata, so the embedded select is untyped.
    ;(supabase as any)
      .from('match_reports')
      .select('*, match_report_stats(*)')
      .eq('match_id', matchId)
      .order('created_at', { ascending: true })
      .then(({ data, error: qError }: { data: ReportRow[] | null; error: { message: string } | null }) => {
        if (cancelled) return
        if (qError) {
          setError(qError.message)
          setReports([])
          return
        }
        setReports(data ?? [])
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, resultStatus])

  const dark = teams.find(t => t.name === 'dark')
  const light = teams.find(t => t.name === 'light')
  if (!dark || !light) return null

  const nameOf = (id: string | null | undefined) => {
    if (!id) return 'Desconocido'
    return people.find(p => p.id === id)?.display_name ?? 'Desconocido'
  }
  const statName = (s: MatchReportStat) => nameOf(s.player_id ?? s.guest_player_id)

  const agreesOnScore = (r: MatchReport) =>
    r.dark_score !== null && r.light_score !== null && r.dark_score === dark.score && r.light_score === light.score

  const usable = reports?.filter(r => !r.submitted_after_lock) ?? []
  const agreeing = usable.filter(agreesOnScore).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ClipboardList className="h-5 w-5" />
          Reportes de los jugadores
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {reports === null && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner size="sm" /> Cargando reportes...
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {reports !== null && reports.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">Todavía nadie reportó este partido.</p>
        )}
        {reports !== null && reports.length > 0 && (
          <>
            <p className="text-sm text-muted-foreground">
              {usable.length} de {confirmedCount} reportaron · {agreeing} coinciden con el resultado actual{' '}
              <span className="font-medium text-foreground">
                {dark.score}–{light.score}
              </span>
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-3 font-medium">Jugador</th>
                    <th className="py-2 pr-3 font-medium">Resultado</th>
                    <th className="py-2 pr-3 font-medium">Goles</th>
                    <th className="py-2 pr-3 font-medium">Asistencias</th>
                    <th className="py-2 pr-3 font-medium">MVP</th>
                    <th className="py-2 font-medium">Cuándo</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map(r => {
                    const agrees = agreesOnScore(r)
                    const hasScore = r.dark_score !== null && r.light_score !== null
                    const stats = r.match_report_stats ?? []
                    return (
                      <tr
                        key={r.id}
                        className={`border-b last:border-0 align-top ${r.submitted_after_lock ? 'opacity-60' : ''}`}
                      >
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {nameOf(r.reporter_player_id)}
                          {r.submitted_after_lock && (
                            <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-600">
                              <AlertTriangle className="h-3 w-3" /> después del cierre
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {hasScore ? (
                            <span
                              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                                agrees ? 'bg-green-500/10 text-green-700' : 'bg-amber-500/10 text-amber-700'
                              }`}
                            >
                              {agrees && <Check className="h-3 w-3" />}
                              {r.dark_score}–{r.light_score}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">no recuerda</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <div>
                            <span className="text-muted-foreground">Osc: </span>
                            {fmtStat(stats, dark.id, 'goals', statName)}
                            {r.dark_goals_complete && <span className="text-xs text-muted-foreground"> (completo)</span>}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Cla: </span>
                            {fmtStat(stats, light.id, 'goals', statName)}
                            {r.light_goals_complete && <span className="text-xs text-muted-foreground"> (completo)</span>}
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          <div>
                            <span className="text-muted-foreground">Osc: </span>
                            {fmtStat(stats, dark.id, 'assists', statName)}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Cla: </span>
                            {fmtStat(stats, light.id, 'assists', statName)}
                          </div>
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {r.mvp_candidate_id ? nameOf(r.mvp_candidate_id) : '—'}
                        </td>
                        <td className="py-2 whitespace-nowrap text-muted-foreground">
                          {new Date(r.updated_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
