import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  Plus,
  Settings,
  Users,
  Calendar,
  Copy,
  Share2,
  Trophy,
  Clock
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'

interface PageProps {
  params: Promise<{ groupSlug: string }>
}

type GroupRole = 'admin' | 'captain' | 'member'

interface GroupMember {
  id: string
  role: GroupRole
  player: {
    id: string
    display_name: string
    nickname: string | null
    overall_rating: number
    matches_played: number
    goals: number
    assists: number
    mvp_count: number
  }
}

interface Group {
  id: string
  name: string
  slug: string
  description: string | null
  default_match_day: number | null
  default_match_time: string | null
  default_max_players: number
  invite_code: string
}

interface Match {
  id: string
  date_time: string
  location: string | null
  status: string
  max_players: number
  signup_count: number
}

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

export default async function GroupDetailPage({ params }: PageProps) {
  const { groupSlug } = await params
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  // Get user's player profile
  const { data: playerProfile } = await supabase
    .from('player_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single() as { data: { id: string } | null }

  if (!playerProfile) return notFound()

  // Get group by slug
  const { data: group } = await supabase
    .from('groups')
    .select('*')
    .eq('slug', groupSlug)
    .single() as { data: Group | null }

  if (!group) return notFound()

  // Check if user is a member and get their role
  const { data: membership } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('group_id', group.id)
    .eq('player_id', playerProfile.id)
    .eq('is_active', true)
    .single() as { data: { role: GroupRole } | null }

  if (!membership) return notFound()

  const userRole = membership.role
  const isAdmin = userRole === 'admin'
  const isAdminOrCaptain = userRole === 'admin' || userRole === 'captain'

  // Get group members with player profiles
  type MembershipResult = {
    id: string
    role: GroupRole
    player_profiles: {
      id: string
      display_name: string
      nickname: string | null
      overall_rating: number
      matches_played: number
      goals: number
      assists: number
      mvp_count: number
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
        overall_rating,
        matches_played,
        goals,
        assists,
        mvp_count
      )
    `)
    .eq('group_id', group.id)
    .eq('is_active', true)
    .order('role') as { data: MembershipResult[] | null }

  const members: GroupMember[] = (memberships || [])
    .filter((m): m is MembershipResult & { player_profiles: NonNullable<MembershipResult['player_profiles']> } => m.player_profiles !== null)
    .map(m => ({
      id: m.id,
      role: m.role,
      player: m.player_profiles
    }))

  // Get upcoming matches
  type MatchResult = {
    id: string
    date_time: string
    location: string | null
    status: string
    max_players: number
  }

  const { data: upcomingMatches } = await supabase
    .from('matches')
    .select(`
      id,
      date_time,
      location,
      status,
      max_players
    `)
    .eq('group_id', group.id)
    .in('status', ['draft', 'signup_open', 'full', 'teams_created'])
    .gte('date_time', new Date().toISOString())
    .order('date_time')
    .limit(5) as { data: MatchResult[] | null }

  // Get signup counts for matches
  const matchesWithCounts: Match[] = []
  for (const match of upcomingMatches || []) {
    const { count } = await supabase
      .from('match_signups')
      .select('*', { count: 'exact', head: true })
      .eq('match_id', match.id)
      .eq('status', 'confirmed')

    matchesWithCounts.push({
      ...match,
      signup_count: count || 0
    })
  }

  // Get recent matches
  const { data: recentMatches } = await supabase
    .from('matches')
    .select('id, date_time, location, status')
    .eq('group_id', group.id)
    .eq('status', 'finished')
    .order('date_time', { ascending: false })
    .limit(3) as { data: { id: string; date_time: string; location: string | null; status: string }[] | null }

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/invite/${group.invite_code}`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{group.name}</h1>
            <Badge
              variant={
                userRole === 'admin'
                  ? 'default'
                  : userRole === 'captain'
                  ? 'secondary'
                  : 'outline'
              }
            >
              {userRole === 'admin' ? 'Admin' : userRole === 'captain' ? 'Capitán' : 'Miembro'}
            </Badge>
          </div>
          {group.description && (
            <p className="text-muted-foreground mt-1">{group.description}</p>
          )}
          {group.default_match_day !== null && (
            <p className="text-sm text-muted-foreground mt-1">
              <Clock className="inline h-4 w-4 mr-1" />
              {DAYS[group.default_match_day]}
              {group.default_match_time && ` ${group.default_match_time.slice(0, 5)}`}
              {' · '}{group.default_max_players} jugadores
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {isAdminOrCaptain && (
            <Link href={`/groups/${groupSlug}/matches/new`}>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Crear partido
              </Button>
            </Link>
          )}
          {isAdmin && (
            <Link href={`/groups/${groupSlug}/settings`}>
              <Button variant="outline" size="icon">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Invite Card */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <Share2 className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">Invitar jugadores</p>
                <p className="text-sm text-muted-foreground">
                  Comparte este link para que se unan al grupo
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <code className="bg-muted px-3 py-1.5 rounded text-sm truncate max-w-[200px]">
                {inviteUrl}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (typeof navigator !== 'undefined') {
                    navigator.clipboard.writeText(inviteUrl)
                  }
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Upcoming Matches */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Próximos partidos</h2>
            <Link href={`/groups/${groupSlug}/matches`}>
              <Button variant="ghost" size="sm">Ver todos</Button>
            </Link>
          </div>

          {matchesWithCounts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-8">
                <Calendar className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No hay partidos programados</p>
                {isAdminOrCaptain && (
                  <Link href={`/groups/${groupSlug}/matches/new`} className="mt-3">
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      Crear partido
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {matchesWithCounts.map((match) => {
                const date = new Date(match.date_time)
                const statusColors: Record<string, string> = {
                  draft: 'bg-gray-100 text-gray-800',
                  signup_open: 'bg-green-100 text-green-800',
                  full: 'bg-yellow-100 text-yellow-800',
                  teams_created: 'bg-blue-100 text-blue-800',
                }
                const statusLabels: Record<string, string> = {
                  draft: 'Borrador',
                  signup_open: 'Inscripción abierta',
                  full: 'Completo',
                  teams_created: 'Equipos armados',
                }

                return (
                  <Link key={match.id} href={`/groups/${groupSlug}/matches/${match.id}`}>
                    <Card className="hover:shadow-md transition-shadow">
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">
                              {DAYS[date.getDay()]} {date.toLocaleDateString('es-AR')}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                              {match.location && ` · ${match.location}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <p className="text-sm font-medium">
                                {match.signup_count}/{match.max_players}
                              </p>
                              <p className="text-xs text-muted-foreground">jugadores</p>
                            </div>
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[match.status] || ''}`}>
                              {statusLabels[match.status] || match.status}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          )}

          {/* Recent matches */}
          {recentMatches && recentMatches.length > 0 && (
            <>
              <h2 className="text-lg font-semibold mt-8">Partidos recientes</h2>
              <div className="space-y-2">
                {recentMatches.map((match) => {
                  const date = new Date(match.date_time)
                  return (
                    <Link key={match.id} href={`/groups/${groupSlug}/matches/${match.id}`}>
                      <Card className="hover:shadow-sm transition-shadow">
                        <CardContent className="py-3">
                          <div className="flex items-center justify-between">
                            <p className="text-sm">
                              {DAYS[date.getDay()]} {date.toLocaleDateString('es-AR')}
                              {match.location && ` · ${match.location}`}
                            </p>
                            <Badge variant="outline">Finalizado</Badge>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Members Sidebar */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Miembros ({members.length})</h2>
            <Link href={`/groups/${groupSlug}/players`}>
              <Button variant="ghost" size="sm">Ver todos</Button>
            </Link>
          </div>

          <Card>
            <CardContent className="py-4">
              <div className="space-y-3">
                {members.slice(0, 10).map((member) => (
                  <div key={member.id} className="flex items-center gap-3">
                    <Avatar
                      fallback={member.player.display_name}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {member.player.display_name}
                        {member.player.nickname && (
                          <span className="text-muted-foreground ml-1">
                            ({member.player.nickname})
                          </span>
                        )}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{member.player.matches_played} partidos</span>
                        {member.player.mvp_count > 0 && (
                          <span className="flex items-center gap-0.5">
                            <Trophy className="h-3 w-3" />
                            {member.player.mvp_count}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant={
                        member.role === 'admin'
                          ? 'default'
                          : member.role === 'captain'
                          ? 'secondary'
                          : 'outline'
                      }
                      className="text-xs"
                    >
                      {member.role === 'admin' ? 'Admin' : member.role === 'captain' ? 'Cap' : ''}
                    </Badge>
                  </div>
                ))}
                {members.length > 10 && (
                  <p className="text-sm text-muted-foreground text-center pt-2">
                    +{members.length - 10} más
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
