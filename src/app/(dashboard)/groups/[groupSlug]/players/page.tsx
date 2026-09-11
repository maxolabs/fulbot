import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Trophy, Star, ClipboardList } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { SkillSummaryLine } from '@/components/player-skills'
import { summariesById, type RatingSummary } from '@/lib/ratings'

interface PageProps {
  params: Promise<{ groupSlug: string }>
}

const POSITION_LABELS: Record<string, string> = {
  GK: 'Arquero',
  CB: 'Defensor',
  LB: 'Lateral Izq.',
  RB: 'Lateral Der.',
  CDM: 'Volante Def.',
  CM: 'Mediocampista',
  CAM: 'Enganche',
  LM: 'Medio Izq.',
  RM: 'Medio Der.',
  LW: 'Extremo Izq.',
  RW: 'Extremo Der.',
  ST: 'Delantero',
  CF: 'Centro Delantero',
}

export default async function GroupPlayersPage({ params }: PageProps) {
  const { groupSlug } = await params
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  // Get user's player profile
  const { data: currentPlayer } = await supabase
    .from('player_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single() as { data: { id: string } | null }

  if (!currentPlayer) return notFound()

  // Get group
  const { data: group } = await supabase
    .from('groups')
    .select('id, name, slug')
    .eq('slug', groupSlug)
    .single() as { data: { id: string; name: string; slug: string } | null }

  if (!group) return notFound()

  // Check membership
  const { data: membership } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('group_id', group.id)
    .eq('player_id', currentPlayer.id)
    .eq('is_active', true)
    .single() as { data: { role: 'admin' | 'captain' | 'member' } | null }

  if (!membership) return notFound()

  const isAdmin = membership.role === 'admin'
  const isAdminOrCaptain = isAdmin || membership.role === 'captain'

  // Get all members with full player profiles
  type MembershipWithProfile = {
    id: string
    role: string
    player_profiles: {
      id: string
      display_name: string
      nickname: string | null
      main_position: string
      preferred_positions: string[]
      matches_played: number
      goals: number
      assists: number
      mvp_count: number
      clean_sheets: number
      fitness_status: string
      footedness: string
    } | null
  }

  const { data: memberships } = await supabase
    .from('group_memberships')
    .select(`
      id,
      role,
      player_profiles (
        id,
        display_name,
        nickname,
        main_position,
        preferred_positions,
        matches_played,
        goals,
        assists,
        mvp_count,
        clean_sheets,
        fitness_status,
        footedness
      )
    `)
    .eq('group_id', group.id)
    .eq('is_active', true) as { data: MembershipWithProfile[] | null }

  const players = (memberships || [])
    .filter(m => m.player_profiles !== null)
    .map(m => ({
      role: m.role as 'admin' | 'captain' | 'member',
      ...(m.player_profiles as {
        id: string
        display_name: string
        nickname: string | null
        main_position: string
        preferred_positions: string[]
        matches_played: number
        goals: number
        assists: number
        mvp_count: number
        clean_sheets: number
        fitness_status: string
        footedness: string
      })
    }))
    .sort((a, b) => {
      // Sort by: matches played (desc), then by name
      if (b.matches_played !== a.matches_played) {
        return b.matches_played - a.matches_played
      }
      return a.display_name.localeCompare(b.display_name)
    })

  // Scores are visible to admins and captains only (RLS enforces it on
  // player_rating_summary; this avoids a pointless query for members).
  let summaries = summariesById(null)
  if (isAdminOrCaptain && players.length > 0) {
    const { data: summaryRows } = await supabase
      .from('player_rating_summary')
      .select('player_id, goalkeeping, defense, attack, physical, overall, tags, peer_votes, matches_rated')
      .in('player_id', players.map(p => p.id)) as { data: RatingSummary[] | null }
    summaries = summariesById(summaryRows)
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Link
        href={`/groups/${groupSlug}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Volver a {group.name}
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Jugadores</h1>
          <p className="text-muted-foreground">{players.length} miembros en {group.name}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/groups/${groupSlug}/rate`}>
            <Button variant="outline" size="sm">
              <Star className="mr-2 h-4 w-4" />
              Calificar compañeros
            </Button>
          </Link>
          {isAdmin && (
            <Link href={`/groups/${groupSlug}/rate?mode=baseline`}>
              <Button variant="outline" size="sm">
                <ClipboardList className="mr-2 h-4 w-4" />
                Puntaje base
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Players Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {players.map((player) => (
          <Link key={player.id} href={`/groups/${groupSlug}/players/${player.id}`}>
          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <Avatar fallback={player.display_name} size="lg" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold truncate">{player.display_name}</h3>
                    {player.role !== 'member' && (
                      <Badge
                        variant={player.role === 'admin' ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {player.role === 'admin' ? 'Admin' : 'Cap'}
                      </Badge>
                    )}
                  </div>
                  {player.nickname && (
                    <p className="text-sm text-muted-foreground">{player.nickname}</p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {POSITION_LABELS[player.main_position] || player.main_position}
                  </p>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-4 gap-2 mt-4 pt-4 border-t">
                <div className="text-center">
                  <p className="text-lg font-semibold">{player.matches_played}</p>
                  <p className="text-xs text-muted-foreground">Partidos</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold">{player.goals}</p>
                  <p className="text-xs text-muted-foreground">Goles</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold">{player.assists}</p>
                  <p className="text-xs text-muted-foreground">Asist.</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold flex items-center justify-center gap-1">
                    {player.mvp_count > 0 && <Trophy className="h-4 w-4 text-yellow-500" />}
                    {player.mvp_count}
                  </p>
                  <p className="text-xs text-muted-foreground">MVPs</p>
                </div>
              </div>

              {/* Scores (admins/captains) + physical notes */}
              <div className="flex flex-col gap-2 mt-4 pt-4 border-t">
                {isAdminOrCaptain && <SkillSummaryLine summary={summaries.get(player.id)} />}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>
                    {player.footedness === 'left'
                      ? 'Zurdo'
                      : player.footedness === 'right'
                      ? 'Diestro'
                      : 'Ambidiestro'}
                  </span>
                  {player.fitness_status !== 'ok' && (
                    <Badge variant={player.fitness_status === 'injured' ? 'destructive' : 'warning'}>
                      {player.fitness_status === 'injured' ? 'Lesionado' : 'Limitado'}
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
