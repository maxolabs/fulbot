'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Minus, Check, ClipboardList, Trophy, Pencil, Trash2, Lock, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react'
import { useT } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import type { Json, MatchReportStatInput, MatchResultStatus } from '@/types/database'

// Player-side report of a finished match (§6 of docs/match-results-consensus.md).
// Three optional steps: score, goals/assists per team, MVP. Everything is
// partial evidence -- a player not mentioned means "no me acuerdo", not zero --
// so nothing is required except that the report isn't empty.
//
// Blind rule: this component only ever receives `agreement` (and the page only
// renders the consensus block) once the viewer's own report exists.

export interface ReportPlayer {
  key: string
  player_id: string | null
  guest_player_id: string | null
  display_name: string
}

export interface ReportTeam {
  id: string
  name: 'dark' | 'light'
  color_hex: string
  players: ReportPlayer[]
}

export interface MvpCandidate {
  id: string
  display_name: string
  nickname: string | null
}

export interface OwnReportStat {
  team_id: string
  player_id: string | null
  guest_player_id: string | null
  goals: number
  assists: number
}

export interface OwnReport {
  dark_score: number | null
  light_score: number | null
  dark_goals_complete: boolean
  light_goals_complete: boolean
  mvp_candidate_id: string | null
  submitted_after_lock: boolean
  stats: OwnReportStat[]
}

interface ReportFormProps {
  matchId: string
  teams: ReportTeam[]
  mvpCandidates: MvpCandidate[]
  existingReport: OwnReport | null
  /** Reports agreeing with the viewer's score pair / reports with a score. Only set once the viewer reported. */
  agreement: { same: number; total: number } | null
  windowOpen: boolean
  resultStatus: MatchResultStatus
  /** Group has member scoring on: a usable report earns "+1 compromiso" (docs/member-scoring.md §5.5). */
  scoringEnabled?: boolean
}

type Counts = Record<string, { goals: number; assists: number }>

const STEPS = ['Resultado', 'Goles', 'MVP'] as const

function statKey(teamId: string, playerKey: string) {
  return `${teamId}:${playerKey}`
}

function countsFromReport(report: OwnReport | null): Counts {
  const counts: Counts = {}
  for (const s of report?.stats || []) {
    const playerKey = s.player_id || s.guest_player_id
    if (!playerKey) continue
    counts[statKey(s.team_id, playerKey)] = { goals: s.goals, assists: s.assists }
  }
  return counts
}

// supabase.rpc resolves with `{ error }` (a plain PostgrestError, not an Error
// instance): read the SQL layer's Spanish message off `.message`.
function errorMessage(err: unknown, fallback: string): string {
  const message = (err as { message?: unknown } | null)?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

function teamLabel(name: 'dark' | 'light') {
  return name === 'dark' ? 'Oscuro' : 'Claro'
}

export function ReportForm({
  matchId,
  teams,
  mvpCandidates,
  existingReport,
  agreement,
  windowOpen,
  resultStatus,
  scoringEnabled = false,
}: ReportFormProps) {
  const router = useRouter()
  const supabase = createClient()
  const t = useT()
  // True right after this visit's submit, so the "+1 compromiso" feedback closes
  // the loop on the spot and doesn't nag on later visits to the same report.
  const [justSaved, setJustSaved] = useState(false)

  const darkTeam = teams.find(t => t.name === 'dark')
  const lightTeam = teams.find(t => t.name === 'light')

  const [editing, setEditing] = useState(existingReport === null)
  const [step, setStep] = useState(0)
  const [scoreKnown, setScoreKnown] = useState(
    existingReport ? existingReport.dark_score !== null && existingReport.light_score !== null : true
  )
  const [darkScore, setDarkScore] = useState(existingReport?.dark_score ?? 0)
  const [lightScore, setLightScore] = useState(existingReport?.light_score ?? 0)
  const [counts, setCounts] = useState<Counts>(() => countsFromReport(existingReport))
  const [complete, setComplete] = useState<Record<string, boolean>>(() => ({
    ...(darkTeam ? { [darkTeam.id]: existingReport?.dark_goals_complete ?? false } : {}),
    ...(lightTeam ? { [lightTeam.id]: existingReport?.light_goals_complete ?? false } : {}),
  }))
  const [showOthers, setShowOthers] = useState<Record<string, boolean>>({})
  const [mvp, setMvp] = useState<string | null>(existingReport?.mvp_candidate_id ?? null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!darkTeam || !lightTeam) return null

  // A lock does not close the form: while the window is open a late report is
  // still stored (flagged submitted_after_lock by the RPC) for the admin to see.
  const canEdit = windowOpen
  const isLocked = resultStatus === 'locked'

  const startEditing = () => {
    setScoreKnown(existingReport ? existingReport.dark_score !== null && existingReport.light_score !== null : true)
    setDarkScore(existingReport?.dark_score ?? 0)
    setLightScore(existingReport?.light_score ?? 0)
    setCounts(countsFromReport(existingReport))
    setComplete({
      [darkTeam.id]: existingReport?.dark_goals_complete ?? false,
      [lightTeam.id]: existingReport?.light_goals_complete ?? false,
    })
    setMvp(existingReport?.mvp_candidate_id ?? null)
    setError(null)
    setStep(0)
    setEditing(true)
  }

  const bump = (teamId: string, playerKey: string, field: 'goals' | 'assists', delta: number) => {
    setCounts(prev => {
      const key = statKey(teamId, playerKey)
      const current = prev[key] || { goals: 0, assists: 0 }
      const next = { ...current, [field]: Math.max(0, Math.min(99, current[field] + delta)) }
      const copy = { ...prev }
      if (next.goals === 0 && next.assists === 0) delete copy[key]
      else copy[key] = next
      return copy
    })
  }

  const teamTotals = (teamId: string) => {
    let goals = 0
    let assists = 0
    for (const [key, value] of Object.entries(counts)) {
      if (key.startsWith(`${teamId}:`)) {
        goals += value.goals
        assists += value.assists
      }
    }
    return { goals, assists }
  }

  const buildStats = (): MatchReportStatInput[] => {
    const stats: MatchReportStatInput[] = []
    for (const [key, value] of Object.entries(counts)) {
      if (value.goals === 0 && value.assists === 0) continue
      const [teamId, playerKey] = key.split(':')
      const team = teams.find(t => t.id === teamId)
      const player = teams.flatMap(t => t.players).find(p => p.key === playerKey)
      if (!team || !player) continue
      stats.push({
        team_id: teamId,
        player_id: player.player_id,
        guest_player_id: player.guest_player_id,
        goals: value.goals,
        assists: value.assists,
      })
    }
    return stats
  }

  const isEmpty = !scoreKnown && Object.keys(counts).length === 0 && !mvp
    && !complete[darkTeam.id] && !complete[lightTeam.id]

  const handleSubmit = async () => {
    if (isEmpty) {
      setError('El reporte está vacío: cargá al menos el resultado, un gol o el MVP.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc('submit_match_report', {
        p_match_id: matchId,
        p_dark_score: scoreKnown ? darkScore : null,
        p_light_score: scoreKnown ? lightScore : null,
        p_dark_goals_complete: !!complete[darkTeam.id],
        p_light_goals_complete: !!complete[lightTeam.id],
        p_mvp_candidate_id: mvp,
        p_stats: buildStats() as unknown as Json,
      })
      if (rpcError) throw rpcError
      setEditing(false)
      setStep(0)
      setJustSaved(true)
      router.refresh()
    } catch (err) {
      setError(errorMessage(err, 'No se pudo guardar el reporte'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('¿Borrar tu reporte de este partido?')) return
    setSaving(true)
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc('delete_my_match_report', { p_match_id: matchId })
      if (rpcError) throw rpcError
      setCounts({})
      setMvp(null)
      setScoreKnown(true)
      setDarkScore(0)
      setLightScore(0)
      setComplete({ [darkTeam.id]: false, [lightTeam.id]: false })
      setEditing(true)
      setStep(0)
      router.refresh()
    } catch (err) {
      setError(errorMessage(err, 'No se pudo borrar el reporte'))
    } finally {
      setSaving(false)
    }
  }

  // ---------------------------------------------------------------- summary
  if (!editing && existingReport) {
    const nameOf = (s: OwnReportStat) => {
      const key = s.player_id || s.guest_player_id
      return teams.flatMap(t => t.players).find(p => p.key === key)?.display_name || 'Jugador'
    }
    const mvpName = mvpCandidates.find(c => c.id === existingReport.mvp_candidate_id)?.display_name ?? null
    const hasScore = existingReport.dark_score !== null && existingReport.light_score !== null

    return (
      <Card id="reportar">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Tu reporte
          </CardTitle>
          {agreement && agreement.total > 0 && hasScore && (
            <p className="text-sm text-muted-foreground mt-1">
              Coincidís con {agreement.same} de {agreement.total} en el resultado
            </p>
          )}
          {existingReport.submitted_after_lock && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
              <Lock className="h-3 w-3" />
              Enviado después del cierre: no cambia el resultado
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {scoringEnabled && justSaved && !existingReport.submitted_after_lock && (
            <p
              className="flex items-center justify-center gap-1.5 text-sm font-medium text-primary"
              title={t('memberScore.plusOneHint')}
              data-testid="report-plus-one"
            >
              <Sparkles className="h-4 w-4" />
              {t('memberScore.plusOne')}
            </p>
          )}

          <div className="flex items-center justify-center gap-4 text-center">
            <div>
              <span className="text-xs text-muted-foreground">Oscuro</span>
              <p className="text-2xl font-bold">{hasScore ? existingReport.dark_score : '?'}</p>
            </div>
            <span className="text-xl text-muted-foreground font-light">—</span>
            <div>
              <span className="text-xs text-muted-foreground">Claro</span>
              <p className="text-2xl font-bold">{hasScore ? existingReport.light_score : '?'}</p>
            </div>
          </div>

          {existingReport.stats.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 text-sm">
              {[darkTeam, lightTeam].map(team => {
                const rows = existingReport.stats.filter(s => s.team_id === team.id)
                if (rows.length === 0) return null
                return (
                  <div key={team.id}>
                    <p className="text-xs text-muted-foreground mb-1">{teamLabel(team.name)}</p>
                    {rows.map(s => (
                      <p key={`${s.team_id}-${s.player_id || s.guest_player_id}`} className="pl-2">
                        <span className="font-medium">{nameOf(s)}</span>
                        <span className="text-muted-foreground">
                          {s.goals > 0 && ` ${s.goals} ${s.goals === 1 ? 'gol' : 'goles'}`}
                          {s.goals > 0 && s.assists > 0 && ' ·'}
                          {s.assists > 0 && ` ${s.assists} asist.`}
                        </span>
                      </p>
                    ))}
                  </div>
                )
              })}
            </div>
          )}

          {mvpName && (
            <p className="flex items-center gap-1.5 text-sm text-yellow-600 dark:text-yellow-500">
              <Trophy className="h-4 w-4" />
              Tu MVP: {mvpName}
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {canEdit && isLocked && !existingReport.submitted_after_lock && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" />
              El resultado ya está cerrado por el admin; si lo editás, queda registrado igual.
            </p>
          )}

          {canEdit ? (
            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={startEditing} disabled={saving}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDelete} disabled={saving}>
                <Trash2 className="mr-2 h-4 w-4" />
                Borrar
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" />
              La ventana para reportar cerró
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  // ------------------------------------------------------------ closed window
  if (!canEdit) {
    return (
      <Card id="reportar">
        <CardContent className="py-4 text-sm text-muted-foreground flex items-center gap-2">
          <Lock className="h-4 w-4" />
          La ventana para reportar este partido cerró.
        </CardContent>
      </Card>
    )
  }

  // ------------------------------------------------------------------- form
  const renderStepper = (label: string, value: number, setValue: (v: number) => void, color: string) => (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-1.5">
        <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: color }} />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon" onClick={() => setValue(Math.max(0, value - 1))} aria-label={`Menos ${label}`}>
          <Minus className="h-4 w-4" />
        </Button>
        <span className="text-3xl sm:text-4xl font-bold w-10 sm:w-12 text-center tabular-nums">{value}</span>
        <Button type="button" variant="outline" size="icon" onClick={() => setValue(Math.min(99, value + 1))} aria-label={`Más ${label}`}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )

  const renderCounter = (
    teamId: string,
    playerKey: string,
    field: 'goals' | 'assists',
    value: number,
    label: string,
  ) => (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => bump(teamId, playerKey, field, -1)}
        disabled={value === 0}
        className="h-7 w-7 rounded-md border text-sm disabled:opacity-30 hover:bg-muted"
        aria-label={`Quitar ${label}`}
      >
        −
      </button>
      <span className={`w-8 text-center text-sm tabular-nums ${value > 0 ? 'font-semibold' : 'text-muted-foreground'}`}>
        {field === 'goals' ? '⚽' : 'A'} {value}
      </span>
      <button
        type="button"
        onClick={() => bump(teamId, playerKey, field, 1)}
        className="h-7 w-7 rounded-md border text-sm hover:bg-muted"
        aria-label={`Sumar ${label}`}
      >
        +
      </button>
    </div>
  )

  const renderTeamGoals = (team: ReportTeam, other: ReportTeam) => {
    const totals = teamTotals(team.id)
    const targetScore = scoreKnown ? (team.name === 'dark' ? darkScore : lightScore) : null
    const matchesScore = targetScore !== null && totals.goals === targetScore
    const overScore = targetScore !== null && totals.goals > targetScore
    const players = showOthers[team.id] ? [...team.players, ...other.players] : team.players

    return (
      <div key={team.id} className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full border" style={{ backgroundColor: team.color_hex }} />
            <span className="text-sm font-medium">{teamLabel(team.name)}</span>
          </div>
          <span
            className={`text-xs tabular-nums ${
              overScore ? 'text-destructive' : matchesScore ? 'text-green-600 dark:text-green-500' : 'text-muted-foreground'
            }`}
          >
            {targetScore !== null ? `${totals.goals} / ${targetScore} goles` : `${totals.goals} goles`}
          </span>
        </div>

        <div className="divide-y rounded-lg border">
          {players.map(player => {
            const value = counts[statKey(team.id, player.key)] || { goals: 0, assists: 0 }
            const foreign = !team.players.some(p => p.key === player.key)
            return (
              <div key={player.key} className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2">
                <span className="flex-1 min-w-0 truncate text-sm">
                  {player.display_name}
                  {foreign && <span className="text-xs text-muted-foreground ml-1">(otro equipo)</span>}
                </span>
                {renderCounter(team.id, player.key, 'goals', value.goals, `gol de ${player.display_name}`)}
                {renderCounter(team.id, player.key, 'assists', value.assists, `asistencia de ${player.display_name}`)}
              </div>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={!!complete[team.id]}
              onChange={e => setComplete(prev => ({ ...prev, [team.id]: e.target.checked }))}
            />
            Estos fueron todos los goles de este equipo
          </label>
          {!showOthers[team.id] && (
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setShowOthers(prev => ({ ...prev, [team.id]: true }))}
            >
              ¿Alguien del otro equipo?
            </button>
          )}
        </div>
      </div>
    )
  }

  const otherCandidates = mvpCandidates

  return (
    <Card id="reportar">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ClipboardList className="h-5 w-5" />
          {existingReport ? 'Editá tu reporte' : 'Cargá el resultado'}
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Cargá lo que te acuerdes, el resto lo completan los demás.
        </p>
        {isLocked && (
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
            <Lock className="h-3 w-3" />
            El resultado ya está cerrado por el admin; tu reporte queda registrado igual.
          </p>
        )}
        <ol className="flex flex-wrap items-center gap-2 mt-3 text-xs">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep(i)}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 border transition-colors ${
                  step === i ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted/50'
                }`}
              >
                <span className="font-semibold">{i + 1}</span>
                <span>{label}</span>
              </button>
              {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            </li>
          ))}
        </ol>
      </CardHeader>
      <CardContent className="space-y-5">
        {step === 0 && (
          <div className="space-y-4">
            {scoreKnown ? (
              <div className="flex items-center justify-center gap-3 sm:gap-8">
                {renderStepper('Oscuro', darkScore, setDarkScore, darkTeam.color_hex)}
                <span className="text-2xl text-muted-foreground font-light mt-5 hidden sm:inline">—</span>
                {renderStepper('Claro', lightScore, setLightScore, lightTeam.color_hex)}
              </div>
            ) : (
              <p className="text-center text-sm text-muted-foreground py-4">
                Sin resultado: otros lo van a cargar.
              </p>
            )}
            <div className="flex justify-center">
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setScoreKnown(v => !v)}
              >
                {scoreKnown ? 'No me acuerdo el resultado' : 'Sí me acuerdo el resultado'}
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            {renderTeamGoals(darkTeam, lightTeam)}
            {renderTeamGoals(lightTeam, darkTeam)}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">¿Quién fue el mejor jugador? (opcional)</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {otherCandidates.map(player => (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => setMvp(prev => (prev === player.id ? null : player.id))}
                  className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                    mvp === player.id ? 'border-yellow-500 bg-yellow-500/10' : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <Avatar fallback={player.display_name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{player.display_name}</span>
                    {player.nickname && (
                      <span className="text-xs text-muted-foreground ml-1">({player.nickname})</span>
                    )}
                  </div>
                  {mvp === player.id && <Trophy className="h-4 w-4 text-yellow-500" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Atrás
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" size="sm" onClick={() => setStep(s => s + 1)}>
              Siguiente
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={handleSubmit} disabled={saving}>
              {saving ? <Spinner size="sm" className="mr-2" /> : <Check className="mr-2 h-4 w-4" />}
              {existingReport ? 'Guardar cambios' : 'Enviar reporte'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
