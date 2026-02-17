import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Trophy, Target, Footprints, Star } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'

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
    .single()

  if (!membership) return notFound()

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
      overall_rating: number
      reliability_score: number
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
        overall_rating,
        reliability_score,
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
        overall_rating: number
        reliability_score: number
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

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Jugadores</h1>
        <p className="text-muted-foreground">{players.length} miembros en {group.name}</p>
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

              {/* Rating */}
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <div className="flex items-center gap-1">
                  <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                  <span className="text-sm font-medium">
                    {player.overall_rating.toFixed(1)}
                  </span>
                </div>
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
