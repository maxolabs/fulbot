import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Trophy,
  Star,
  Calendar,
  Target,
  Footprints,
  Shield,
  Award,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { SkillSummaryCard } from '@/components/player-skills'
import type { RatingSummary } from '@/lib/ratings'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { DEFAULT_TIMEZONE, formatMatchDateNumeric, formatMatchDayMonth, formatMatchTime, weekdayIndexInTimezone } from '@/lib/utils/datetime'

interface PageProps {
  params: Promise<{ groupSlug: string; playerId: string }>
}

const POSITION_LABELS: Record<string, string> = {
  GK: 'Arquero',
  CB: 'Defensor Central',
  LB: 'Lateral Izquierdo',
  RB: 'Lateral Derecho',
  CDM: 'Volante Defensivo',
  CM: 'Mediocampista',
  CAM: 'Enganche',
  LM: 'Medio Izquierdo',
  RM: 'Medio Derecho',
  LW: 'Extremo Izquierdo',
  RW: 'Extremo Derecho',
  ST: 'Delantero',
  CF: 'Centro Delantero',
}

const BADGE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  hat_trick: { label: 'Hat-trick Hero', icon: '⚽', color: 'bg-yellow-500/10 text-yellow-700' },
  playmaker: { label: 'Playmaker', icon: '🎯', color: 'bg-blue-500/10 text-blue-700' },
  ironman: { label: 'Ironman', icon: '💪', color: 'bg-red-500/10 text-red-700' },
  safe_hands: { label: 'Safe Hands', icon: '🧤', color: 'bg-green-500/10 text-green-700' },
  mvp: { label: 'MVP', icon: '🏆', color: 'bg-purple-500/10 text-purple-700' },
  mvp_streak: { label: 'MVP Streak', icon: '🏆', color: 'bg-purple-500/10 text-purple-700' },
  first_match: { label: 'Primera vez', icon: '🌟', color: 'bg-cyan-500/10 text-cyan-700' },
}

export default async function PlayerProfilePage({ params }: PageProps) {
  const { groupSlug, playerId } = await params
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  const { data: currentPlayer } = await supabase
    .from('player_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single() as { data: { id: string } | null }

  if (!currentPlayer) return notFound()

  // Get group
  const { data: group } = await supabase
    .from('groups')
    .select('id, name, slug, timezone')
    .eq('slug', groupSlug)
    .single() as { data: { id: string; name: string; slug: string; timezone: string | null } | null }

  if (!group) return notFound()

  const timeZone = group.timezone || DEFAULT_TIMEZONE

  // Get player profile
  type PlayerProfileFull = {
    id: string
    display_name: string
    nickname: string | null
    preferred_positions: string[]
    main_position: string
    footedness: string
    goalkeeper_willingness: number
    fitness_status: string
    matches_played: number
    goals: number
    assists: number
    mvp_count: number
    clean_sheets: number
    created_at: string
  }

  const { data: player } = await supabase
    .from('player_profiles')
    .select('*')
    .eq('id', playerId)
    .single() as { data: PlayerProfileFull | null }

  if (!player) return notFound()

  // Viewer's role in this group: scores are visible to admins and captains only
  const { data: viewerMembership } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('group_id', group.id)
    .eq('player_id', currentPlayer.id)
    .eq('is_active', true)
    .single() as { data: { role: 'admin' | 'captain' | 'member' } | null }

  if (!viewerMembership) return notFound()

  const isAdminOrCaptain = viewerMembership.role === 'admin' || viewerMembership.role === 'captain'

  let ratingSummary: RatingSummary | null = null
  if (isAdminOrCaptain) {
    const { data: summaryRow } = await supabase
      .from('player_rating_summary')
      .select('player_id, goalkeeping, defense, attack, physical, overall, tags, peer_votes, matches_rated')
      .eq('player_id', playerId)
      .maybeSingle() as { data: RatingSummary | null }
    ratingSummary = summaryRow
  }

  // Get player badges
  type BadgeRow = {
    id: string
    badge_type: string
    earned_at: string
    metadata: Record<string, unknown>
  }

  const { data: badges } = await supabase
    .from('player_badges')
    .select('*')
    .eq('player_id', playerId)
    .order('earned_at', { ascending: false }) as { data: BadgeRow[] | null }

  // Get recent match history for this player in this group
  type RecentMatch = {
    id: string
    match_id: string
    status: string
    signup_time: string
    matches: {
      id: string
      date_time: string
      location: string | null
      status: string
    } | null
  }

  const { data: recentSignups } = await supabase
    .from('match_signups')
    .select(`
      id,
      match_id,
      status,
      signup_time,
      matches (
        id,
        date_time,
        location,
        status
      )
    `)
    .eq('player_id', playerId)
    .in('status', ['confirmed', 'did_not_show'])
    .order('signup_time', { ascending: false })
    .limit(10) as { data: RecentMatch[] | null }

  const recentMatches = (recentSignups || [])
    .filter(s => s.matches !== null)
    .map(s => ({
      signupStatus: s.status,
      ...(s.matches as { id: string; date_time: string; location: string | null; status: string }),
    }))

  // Get average rating received
  type RatingAgg = { rating: number }
  const { data: ratingsReceived } = await supabase
    .from('match_ratings')
    .select('rating')
    .eq('rated_player_id', playerId) as { data: RatingAgg[] | null }

  const avgRating = ratingsReceived && ratingsReceived.length > 0
    ? ratingsReceived.reduce((sum, r) => sum + r.rating, 0) / ratingsReceived.length
    : null

  const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back button */}
      <Link
        href={`/groups/${groupSlug}/players`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Volver a jugadores
      </Link>

      {/* Player Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <Avatar fallback={player.display_name} size="lg" />
            <div className="flex-1">
              <h1 className="text-2xl font-bold">{player.display_name}</h1>
              {player.nickname && (
                <p className="text-muted-foreground">&quot;{player.nickname}&quot;</p>
              )}
              <div className="flex flex-wrap gap-2 mt-2">
                <Badge variant="secondary">
                  {POSITION_LABELS[player.main_position] || player.main_position}
                </Badge>
                <Badge variant="outline">
                  {player.footedness === 'left'
                    ? 'Zurdo'
                    : player.footedness === 'right'
                    ? 'Diestro'
                    : 'Ambidiestro'}
                </Badge>
                {player.fitness_status !== 'ok' && (
                  <Badge variant={player.fitness_status === 'injured' ? 'destructive' : 'warning'}>
                    {player.fitness_status === 'injured' ? 'Lesionado' : 'Limitado'}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Scores: admins and captains only */}
          {isAdminOrCaptain && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-xs text-muted-foreground mb-3">Calificación del grupo</p>
              <SkillSummaryCard summary={ratingSummary} />
            </div>
          )}

          {/* Preferred positions */}
          {player.preferred_positions.length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-xs text-muted-foreground mb-2">Posiciones preferidas</p>
              <div className="flex gap-2">
                {player.preferred_positions.map((pos) => (
                  <Badge key={pos} variant="outline" className="text-xs">
                    {POSITION_LABELS[pos] || pos}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <Calendar className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
            <p className="text-2xl font-bold">{player.matches_played}</p>
            <p className="text-xs text-muted-foreground">Partidos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <Target className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
            <p className="text-2xl font-bold">{player.goals}</p>
            <p className="text-xs text-muted-foreground">Goles</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <Footprints className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
            <p className="text-2xl font-bold">{player.assists}</p>
            <p className="text-xs text-muted-foreground">Asistencias</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <Trophy className="h-5 w-5 mx-auto mb-2 text-yellow-500" />
            <p className="text-2xl font-bold">{player.mvp_count}</p>
            <p className="text-xs text-muted-foreground">MVPs</p>
          </CardContent>
        </Card>
      </div>

      {/* Additional Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Estadísticas detalladas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Vallas invictas
            </span>
            <span className="font-medium">{player.clean_sheets}</span>
          </div>
          {avgRating !== null && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-2">
                <Star className="h-4 w-4" />
                Rating promedio recibido
              </span>
              <span className="font-medium">{avgRating.toFixed(1)} / 5</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <Award className="h-4 w-4" />
              Voluntad de arquero
            </span>
            <span className="font-medium">
              {['Nunca', 'Si no queda otra', 'Me da igual', 'Me encanta'][player.goalkeeper_willingness]}
            </span>
          </div>
          {player.matches_played > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Goles por partido</span>
              <span className="font-medium">{(player.goals / player.matches_played).toFixed(2)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Badges */}
      {badges && badges.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Insignias</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {badges.map((badge) => {
                const config = BADGE_LABELS[badge.badge_type] || {
                  label: badge.badge_type,
                  icon: '🎖️',
                  color: 'bg-gray-500/10 text-gray-700',
                }
                return (
                  <div
                    key={badge.id}
                    className={`flex items-center gap-3 p-3 rounded-lg ${config.color}`}
                  >
                    <span className="text-2xl">{config.icon}</span>
                    <div>
                      <p className="text-sm font-medium">{config.label}</p>
                      <p className="text-xs opacity-70">
                        {formatMatchDateNumeric(badge.earned_at, timeZone)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Matches */}
      {recentMatches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimos partidos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentMatches.map((match) => {
                const date = new Date(match.date_time)
                return (
                  <Link
                    key={match.id}
                    href={`/groups/${groupSlug}/matches/${match.id}`}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="text-center min-w-[48px]">
                      <p className="text-xs text-muted-foreground">{DAYS[weekdayIndexInTimezone(date, timeZone)]}</p>
                      <p className="text-sm font-medium">
                        {formatMatchDayMonth(date, timeZone)}
                      </p>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm">
                        {match.location || 'Sin ubicación'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatMatchTime(date, timeZone)}
                      </p>
                    </div>
                    <Badge
                      variant={match.status === 'finished' ? 'outline' : match.status === 'cancelled' ? 'destructive' : 'secondary'}
                      className="text-xs"
                    >
                      {match.status === 'finished' ? 'Jugado' : match.status === 'cancelled' ? 'Cancelado' : 'Pendiente'}
                    </Badge>
                  </Link>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
