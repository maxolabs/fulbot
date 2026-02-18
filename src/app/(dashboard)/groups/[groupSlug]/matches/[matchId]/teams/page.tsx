import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { TeamsView } from './teams-view'

interface PageProps {
  params: Promise<{ groupSlug: string; matchId: string }>
}

export default async function TeamsPage({ params }: PageProps) {
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
    .select('id, date_time, status, max_players, ai_input_snapshot')
    .eq('id', matchId)
    .eq('group_id', group.id)
    .single() as { data: {
      id: string
      date_time: string
      status: string
      max_players: number
      ai_input_snapshot: {
        reasoning?: string
        balanceScore?: number
        warnings?: string[]
      } | null
    } | null }

  if (!match) return notFound()

  // Get confirmed signups with player info (registered + guests)
  type SignupResult = {
    id: string
    player_id: string | null
    guest_player_id: string | null
    player_profiles: {
      id: string
      display_name: string
      nickname: string | null
      main_position: string
      overall_rating: number
    } | null
    guest_players: {
      id: string
      display_name: string
    } | null
  }

  const { data: signups } = await supabase
    .from('match_signups')
    .select(`
      id,
      player_id,
      guest_player_id,
      player_profiles (
        id,
        display_name,
        nickname,
        main_position,
        overall_rating
      ),
      guest_players (
        id,
        display_name
      )
    `)
    .eq('match_id', matchId)
    .eq('status', 'confirmed') as { data: SignupResult[] | null }

  const players = (signups || [])
    .filter((s) => s.player_profiles !== null || s.guest_players !== null)
    .map((s) => {
      if (s.player_profiles) {
        return {
          id: s.player_profiles.id,
          displayName: s.player_profiles.display_name,
          nickname: s.player_profiles.nickname,
          mainPosition: s.player_profiles.main_position,
          overallRating: s.player_profiles.overall_rating,
          isGuest: false,
        }
      }
      return {
        id: s.guest_players!.id,
        displayName: s.guest_players!.display_name,
        nickname: null,
        mainPosition: 'CM',
        overallRating: 2.5,
        isGuest: true,
      }
    })

  // Get existing teams if any
  type TeamResult = {
    id: string
    name: 'dark' | 'light'
    color_hex: string
  }

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, color_hex')
    .eq('match_id', matchId) as { data: TeamResult[] | null }

  // Get team assignments
  type AssignmentResult = {
    id: string
    team_id: string
    player_id: string | null
    guest_player_id: string | null
    position: string
    order_index: number
  }

  let darkTeamAssignments: AssignmentResult[] = []
  let lightTeamAssignments: AssignmentResult[] = []

  if (teams && teams.length > 0) {
    const darkTeam = teams.find((t) => t.name === 'dark')
    const lightTeam = teams.find((t) => t.name === 'light')

    if (darkTeam) {
      const { data: darkAssignments } = await supabase
        .from('team_assignments')
        .select('id, team_id, player_id, guest_player_id, position, order_index')
        .eq('team_id', darkTeam.id)
        .order('order_index') as { data: AssignmentResult[] | null }
      darkTeamAssignments = darkAssignments || []
    }

    if (lightTeam) {
      const { data: lightAssignments } = await supabase
        .from('team_assignments')
        .select('id, team_id, player_id, guest_player_id, position, order_index')
        .eq('team_id', lightTeam.id)
        .order('order_index') as { data: AssignmentResult[] | null }
      lightTeamAssignments = lightAssignments || []
    }
  }

  const date = new Date(match.date_time)
  const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Link
        href={`/groups/${groupSlug}/matches/${matchId}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Volver al partido
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Armar equipos</h1>
        <p className="text-muted-foreground">
          {DAYS[date.getDay()]} {date.toLocaleDateString('es-AR')} · {players.length} jugadores
        </p>
      </div>

      <TeamsView
        matchId={matchId}
        groupSlug={groupSlug}
        groupName={group.name}
        matchDate={date}
        players={players}
        darkTeam={{
          id: teams?.find((t) => t.name === 'dark')?.id || null,
          assignments: darkTeamAssignments,
        }}
        lightTeam={{
          id: teams?.find((t) => t.name === 'light')?.id || null,
          assignments: lightTeamAssignments,
        }}
        aiReasoning={match.ai_input_snapshot?.reasoning}
        balanceScore={match.ai_input_snapshot?.balanceScore}
        warnings={match.ai_input_snapshot?.warnings}
        isAdminOrCaptain={isAdminOrCaptain}
        hasTeams={teams !== null && teams.length > 0}
      />
    </div>
  )
}
