import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Calendar,
  Clock,
  MapPin,
  Users,
  Edit,
  Share2,
  Copy,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/ui/copy-button'
import { SignupList } from './signup-list'
import { SignupActions } from './signup-actions'
import { MatchAdminActions } from './match-admin-actions'
import { AddGuestForm } from './add-guest-form'
import { PostMatchVoting } from './post-match-voting'
import { RulesManager } from './rules-manager'
import { RealtimeWrapper } from './realtime-wrapper'
import { MatchResults } from './match-results'
import { MatchScoreDisplay } from './match-score-display'

interface PageProps {
  params: Promise<{ groupSlug: string; matchId: string }>
}

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: 'Borrador', variant: 'outline' },
  signup_open: { label: 'Inscripción abierta', variant: 'default' },
  full: { label: 'Completo', variant: 'secondary' },
  teams_created: { label: 'Equipos armados', variant: 'default' },
  finished: { label: 'Finalizado', variant: 'outline' },
  cancelled: { label: 'Cancelado', variant: 'destructive' },
}

export default async function MatchDetailPage({ params }: PageProps) {
  const { groupSlug, matchId } = await params
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

  // Get match details
  const { data: match } = await supabase
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .eq('group_id', group.id)
    .single() as { data: {
      id: string
      group_id: string
      date_time: string
      location: string | null
      status: string
      max_players: number
      notes: string | null
      results_finalized: boolean
      created_at: string
    } | null }

  if (!match) return notFound()

  // Get signups with player info
  type SignupResult = {
    id: string
    status: string
    signup_time: string
    position_preference: string | null
    notes: string | null
    waitlist_position: number | null
    player_profiles: {
      id: string
      display_name: string
      nickname: string | null
      main_position: string
      overall_rating: number
    } | null
  }

  const { data: signups } = await supabase
    .from('match_signups')
    .select(`
      id,
      status,
      signup_time,
      position_preference,
      notes,
      waitlist_position,
      player_profiles (
        id,
        display_name,
        nickname,
        main_position,
        overall_rating
      )
    `)
    .eq('match_id', matchId)
    .in('status', ['confirmed', 'waitlist'])
    .order('signup_time') as { data: SignupResult[] | null }

  const confirmedSignups = (signups || []).filter(s => s.status === 'confirmed')
  const waitlistSignups = (signups || [])
    .filter(s => s.status === 'waitlist')
    .sort((a, b) => (a.waitlist_position || 0) - (b.waitlist_position || 0))

  // Get all group members for rules and voting
  type MemberProfile = {
    player_profiles: {
      id: string
      display_name: string
      nickname: string | null
      main_position: string
    } | null
  }

  const { data: membershipsData } = await supabase
    .from('group_memberships')
    .select(`
      player_profiles (
        id,
        display_name,
        nickname,
        main_position
      )
    `)
    .eq('group_id', group.id)
    .eq('is_active', true) as { data: MemberProfile[] | null }

  const allGroupPlayers = (membershipsData || [])
    .filter(m => m.player_profiles !== null)
    .map(m => m.player_profiles as { id: string; display_name: string; nickname: string | null; main_position: string })

  // Players who participated (for voting) - from confirmed signups
  const matchPlayers = confirmedSignups
    .filter(s => s.player_profiles !== null)
    .map(s => s.player_profiles as { id: string; display_name: string; nickname: string | null; main_position: string })

  // Check if current user is signed up
  const currentUserSignup = (signups || []).find(
    s => s.player_profiles?.id === playerProfile.id
  )

  // Fetch teams with assignments and match events when match is finished
  type TeamWithPlayers = {
    id: string
    name: 'dark' | 'light'
    color_hex: string
    score: number
    team_assignments: {
      player_id: string | null
      guest_player_id: string | null
      position: string
      player_profiles: { id: string; display_name: string } | null
      guest_players: { id: string; display_name: string } | null
    }[]
  }

  type MatchEventResult = {
    id: string
    team_id: string
    player_id: string | null
    guest_player_id: string | null
    event_type: string
    linked_event_id: string | null
    player_profiles: { id: string; display_name: string } | null
    guest_players: { id: string; display_name: string } | null
  }

  let matchTeams: TeamWithPlayers[] = []
  let matchEvents: MatchEventResult[] = []

  if (match.status === 'finished') {
    const { data: teamsData } = await supabase
      .from('teams')
      .select(`
        id,
        name,
        color_hex,
        score,
        team_assignments (
          player_id,
          guest_player_id,
          position,
          player_profiles ( id, display_name ),
          guest_players ( id, display_name )
        )
      `)
      .eq('match_id', matchId) as { data: TeamWithPlayers[] | null }

    matchTeams = teamsData || []

    const { data: eventsData } = await supabase
      .from('match_events')
      .select(`
        id,
        team_id,
        player_id,
        guest_player_id,
        event_type,
        linked_event_id,
        player_profiles ( id, display_name ),
        guest_players ( id, display_name )
      `)
      .eq('match_id', matchId) as { data: MatchEventResult[] | null }

    matchEvents = eventsData || []
  }

  // Prepare teams data for MatchResults component
  const teamsForResults = matchTeams.map(t => ({
    id: t.id,
    name: t.name,
    color_hex: t.color_hex,
    score: t.score,
    players: t.team_assignments.map(a => ({
      id: a.player_id || a.guest_player_id || '',
      display_name: a.player_profiles?.display_name || a.guest_players?.display_name || 'Desconocido',
      is_guest: !!a.guest_player_id,
      player_id: a.player_id,
      guest_player_id: a.guest_player_id,
    })),
  }))

  // Prepare goal details for MatchScoreDisplay
  const goalDetails = matchEvents
    .filter(e => e.event_type === 'goal')
    .map(goal => {
      const assist = matchEvents.find(e => e.event_type === 'assist' && e.linked_event_id === goal.id)
      return {
        id: goal.id,
        team_id: goal.team_id,
        scorer_name: goal.player_profiles?.display_name || goal.guest_players?.display_name || 'Desconocido',
        assister_name: assist
          ? (assist.player_profiles?.display_name || assist.guest_players?.display_name || null)
          : null,
        event_type: goal.event_type,
      }
    })

  const hasRecordedResults = matchEvents.length > 0

  const date = new Date(match.date_time)
  const isPast = date < new Date()
  const statusConfig = STATUS_CONFIG[match.status] || STATUS_CONFIG.draft

  const signupUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/m/${matchId}`

  return (
    <RealtimeWrapper matchId={matchId}>
      <div className="space-y-6">
        {/* Back button */}
        <Link
          href={`/groups/${groupSlug}`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a {group.name}
        </Link>

      {/* Match Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold tracking-tight">
              {DAYS[date.getDay()]} {date.toLocaleDateString('es-AR')}
            </h1>
            <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
          </div>

          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
            </span>
            {match.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4" />
                {match.location}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              {confirmedSignups.length}/{match.max_players} jugadores
            </span>
          </div>
        </div>

        {isAdminOrCaptain && (
          <div className="flex gap-2">
            <Link href={`/groups/${groupSlug}/matches/${matchId}/edit`}>
              <Button variant="outline" size="sm">
                <Edit className="mr-2 h-4 w-4" />
                Editar
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* Notes */}
      {match.notes && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm">{match.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Share Card */}
      {(match.status === 'signup_open' || match.status === 'full') && (
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-3">
                <Share2 className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Compartir partido</p>
                  <p className="text-sm text-muted-foreground">
                    Envía este link para que se inscriban
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <code className="bg-muted px-3 py-1.5 rounded text-sm truncate max-w-[200px]">
                  {signupUrl}
                </code>
                <CopyButton text={signupUrl} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content - Signup List */}
        <div className="lg:col-span-2 space-y-6">
          {/* Signup Actions for Current User */}
          {!isPast && match.status !== 'cancelled' && match.status !== 'finished' && (
            <SignupActions
              matchId={match.id}
              playerId={playerProfile.id}
              currentSignup={currentUserSignup ? {
                id: currentUserSignup.id,
                status: currentUserSignup.status,
                waitlistPosition: currentUserSignup.waitlist_position,
              } : null}
              matchStatus={match.status}
              isFull={confirmedSignups.length >= match.max_players}
            />
          )}

          {/* Confirmed Players */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Confirmados ({confirmedSignups.length}/{match.max_players})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SignupList
                signups={confirmedSignups}
                currentPlayerId={playerProfile.id}
                emptyMessage="Nadie se inscribió todavía"
              />
            </CardContent>
          </Card>

          {/* Waitlist */}
          {waitlistSignups.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Lista de espera ({waitlistSignups.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SignupList
                  signups={waitlistSignups}
                  currentPlayerId={playerProfile.id}
                  showWaitlistPosition
                  emptyMessage="No hay nadie en espera"
                />
              </CardContent>
            </Card>
          )}

          {/* Match Score Display - shown to everyone when results exist */}
          {match.status === 'finished' && hasRecordedResults && !isAdminOrCaptain && (
            <MatchScoreDisplay
              teams={matchTeams.map(t => ({ id: t.id, name: t.name, color_hex: t.color_hex, score: t.score }))}
              goals={goalDetails}
            />
          )}

          {/* Match Results Editor - shown to admins when match is finished */}
          {match.status === 'finished' && isAdminOrCaptain && teamsForResults.length > 0 && (
            <MatchResults
              matchId={match.id}
              teams={teamsForResults}
              existingEvents={matchEvents.map(e => ({
                id: e.id,
                team_id: e.team_id,
                player_id: e.player_id,
                guest_player_id: e.guest_player_id,
                event_type: e.event_type,
                linked_event_id: e.linked_event_id,
              }))}
              resultsFinalized={match.results_finalized}
            />
          )}

          {/* Match Score Display - also shown below editor for admins */}
          {match.status === 'finished' && hasRecordedResults && isAdminOrCaptain && (
            <MatchScoreDisplay
              teams={matchTeams.map(t => ({ id: t.id, name: t.name, color_hex: t.color_hex, score: t.score }))}
              goals={goalDetails}
            />
          )}

          {/* Post-match voting - shown when match is finished */}
          {match.status === 'finished' && matchPlayers.length > 0 && (
            <PostMatchVoting
              matchId={match.id}
              currentPlayerId={playerProfile.id}
              players={matchPlayers}
            />
          )}
        </div>

        {/* Sidebar - Admin Actions */}
        <div className="space-y-6">
          {isAdminOrCaptain && (
            <MatchAdminActions
              matchId={match.id}
              groupSlug={groupSlug}
              currentStatus={match.status}
              hasEnoughPlayers={confirmedSignups.length >= 4}
            />
          )}

          {/* Add Guest - Admin only */}
          {isAdminOrCaptain && match.status !== 'finished' && match.status !== 'cancelled' && (
            <AddGuestForm
              matchId={match.id}
              groupId={group.id}
              isFull={confirmedSignups.length >= match.max_players}
              maxPlayers={match.max_players}
              confirmedCount={confirmedSignups.length}
            />
          )}

          {/* Rules Manager - Admin only, before teams are created */}
          {isAdminOrCaptain && (match.status === 'signup_open' || match.status === 'full') && (
            <RulesManager
              groupId={group.id}
              matchId={match.id}
              players={allGroupPlayers}
            />
          )}

          {/* Quick Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Estadísticas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Inscritos</span>
                <span className="font-medium">{confirmedSignups.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">En espera</span>
                <span className="font-medium">{waitlistSignups.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Disponibles</span>
                <span className="font-medium">
                  {Math.max(0, match.max_players - confirmedSignups.length)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      </div>
    </RealtimeWrapper>
  )
}
