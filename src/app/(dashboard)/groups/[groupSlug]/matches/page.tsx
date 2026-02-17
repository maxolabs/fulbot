import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Calendar, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface PageProps {
  params: Promise<{ groupSlug: string }>
}

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: 'Borrador', color: 'bg-gray-100 text-gray-800' },
  signup_open: { label: 'Inscripción abierta', color: 'bg-green-100 text-green-800' },
  full: { label: 'Completo', color: 'bg-yellow-100 text-yellow-800' },
  teams_created: { label: 'Equipos armados', color: 'bg-blue-100 text-blue-800' },
  finished: { label: 'Finalizado', color: 'bg-gray-100 text-gray-600' },
  cancelled: { label: 'Cancelado', color: 'bg-red-100 text-red-800' },
}

export default async function MatchesListPage({ params }: PageProps) {
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

  // Get group
  const { data: group } = await supabase
    .from('groups')
    .select('id, name, slug')
    .eq('slug', groupSlug)
    .single() as { data: { id: string; name: string; slug: string } | null }

  if (!group) return notFound()

  // Check membership and get role
  const { data: membership } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('group_id', group.id)
    .eq('player_id', playerProfile.id)
    .eq('is_active', true)
    .single() as { data: { role: string } | null }

  if (!membership) return notFound()

  const isAdminOrCaptain = membership.role === 'admin' || membership.role === 'captain'

  // Get all matches for this group
  type MatchResult = {
    id: string
    date_time: string
    location: string | null
    status: string
    max_players: number
  }

  const { data: matches } = await supabase
    .from('matches')
    .select('id, date_time, location, status, max_players')
    .eq('group_id', group.id)
    .order('date_time', { ascending: false }) as { data: MatchResult[] | null }

  // Get signup counts for all matches
  const matchesWithCounts = await Promise.all(
    (matches || []).map(async (match) => {
      const { count } = await supabase
        .from('match_signups')
        .select('*', { count: 'exact', head: true })
        .eq('match_id', match.id)
        .eq('status', 'confirmed')

      return {
        ...match,
        signup_count: count || 0,
      }
    })
  )

  // Separate upcoming and past matches
  const now = new Date()
  const upcomingMatches = matchesWithCounts.filter(
    m => new Date(m.date_time) >= now && m.status !== 'cancelled'
  )
  const pastMatches = matchesWithCounts.filter(
    m => new Date(m.date_time) < now || m.status === 'cancelled'
  )

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

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Partidos</h1>
          <p className="text-muted-foreground">
            {matchesWithCounts.length} partidos en total
          </p>
        </div>
        {isAdminOrCaptain && (
          <Link href={`/groups/${groupSlug}/matches/new`}>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Crear partido
            </Button>
          </Link>
        )}
      </div>

      {/* Upcoming Matches */}
      {upcomingMatches.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Próximos partidos</h2>
          <div className="space-y-3">
            {upcomingMatches.map((match) => {
              const date = new Date(match.date_time)
              const status = STATUS_CONFIG[match.status] || STATUS_CONFIG.draft

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
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${status.color}`}>
                            {status.label}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty State for Upcoming */}
      {upcomingMatches.length === 0 && (
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
      )}

      {/* Past Matches */}
      {pastMatches.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Partidos anteriores</h2>
          <div className="space-y-2">
            {pastMatches.map((match) => {
              const date = new Date(match.date_time)
              const status = STATUS_CONFIG[match.status] || STATUS_CONFIG.draft

              return (
                <Link key={match.id} href={`/groups/${groupSlug}/matches/${match.id}`}>
                  <Card className="hover:shadow-sm transition-shadow">
                    <CardContent className="py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <p className="text-sm">
                            {DAYS[date.getDay()]} {date.toLocaleDateString('es-AR')}
                          </p>
                          {match.location && (
                            <span className="text-sm text-muted-foreground">
                              {match.location}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground">
                            {match.signup_count} jugadores
                          </span>
                          <Badge variant="outline">{status.label}</Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
