import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateTeams, PlayerInput, RuleInput } from '@/lib/ai/team-generator'

interface RouteContext {
  params: Promise<{ matchId: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { matchId } = await context.params
    const supabase = await createClient()

    // Check authentication
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Get user's player profile
    const { data: playerProfile } = await supabase
      .from('player_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single() as { data: { id: string } | null }

    if (!playerProfile) {
      return NextResponse.json({ error: 'Perfil no encontrado' }, { status: 400 })
    }

    // Get match with group info
    const { data: match } = await supabase
      .from('matches')
      .select('id, group_id, status, max_players')
      .eq('id', matchId)
      .single() as { data: { id: string; group_id: string; status: string; max_players: number } | null }

    if (!match) {
      return NextResponse.json({ error: 'Partido no encontrado' }, { status: 404 })
    }

    // Check if user is admin or captain of the group
    const { data: membership } = await supabase
      .from('group_memberships')
      .select('role')
      .eq('group_id', match.group_id)
      .eq('player_id', playerProfile.id)
      .eq('is_active', true)
      .single() as { data: { role: string } | null }

    if (!membership || (membership.role !== 'admin' && membership.role !== 'captain')) {
      return NextResponse.json({ error: 'No tenés permiso para armar equipos' }, { status: 403 })
    }

    // Get confirmed signups with player profiles and guest players
    type SignupWithPlayer = {
      id: string
      player_id: string | null
      guest_player_id: string | null
      player_profiles: {
        id: string
        display_name: string
        nickname: string | null
        main_position: string
        preferred_positions: string[]
        overall_rating: number
        footedness: 'left' | 'right' | 'both'
        goalkeeper_willingness: number
        fitness_status: 'ok' | 'limited' | 'injured'
        reliability_score: number
        matches_played: number
        goals: number
        assists: number
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
          preferred_positions,
          overall_rating,
          footedness,
          goalkeeper_willingness,
          fitness_status,
          reliability_score,
          matches_played,
          goals,
          assists
        ),
        guest_players (
          id,
          display_name
        )
      `)
      .eq('match_id', matchId)
      .eq('status', 'confirmed') as { data: SignupWithPlayer[] | null }

    if (!signups || signups.length < 4) {
      return NextResponse.json(
        { error: 'Se necesitan al menos 4 jugadores confirmados' },
        { status: 400 }
      )
    }

    // Convert to PlayerInput format (registered players + guests)
    const players: PlayerInput[] = signups
      .filter((s) => s.player_profiles !== null || s.guest_players !== null)
      .map((s) => {
        if (s.player_profiles) {
          return {
            id: s.player_profiles.id,
            displayName: s.player_profiles.display_name,
            nickname: s.player_profiles.nickname,
            mainPosition: s.player_profiles.main_position,
            preferredPositions: s.player_profiles.preferred_positions,
            overallRating: s.player_profiles.overall_rating,
            footedness: s.player_profiles.footedness,
            goalkeeperWillingness: s.player_profiles.goalkeeper_willingness,
            fitnessStatus: s.player_profiles.fitness_status,
            reliabilityScore: s.player_profiles.reliability_score,
            matchesPlayed: s.player_profiles.matches_played,
            goals: s.player_profiles.goals,
            assists: s.player_profiles.assists,
          }
        }
        // Guest player with sensible defaults
        return {
          id: s.guest_players!.id,
          displayName: s.guest_players!.display_name,
          nickname: null,
          mainPosition: 'CM',
          preferredPositions: ['CM', 'ST', 'CB'],
          overallRating: 2.5,
          footedness: 'right' as const,
          goalkeeperWillingness: 1,
          fitnessStatus: 'ok' as const,
          reliabilityScore: 50,
          matchesPlayed: 0,
          goals: 0,
          assists: 0,
          isGuest: true,
        }
      })

    // Get rules for this group/match
    type RuleRow = {
      rule_type: string
      data: { player_ids?: string[]; value?: number }
    }

    const { data: rules } = await supabase
      .from('rule_sets')
      .select('rule_type, data')
      .or(`group_id.eq.${match.group_id},match_id.eq.${matchId}`)
      .eq('is_active', true) as { data: RuleRow[] | null }

    const ruleInputs: RuleInput[] = (rules || []).map((r) => ({
      type: r.rule_type as RuleInput['type'],
      playerIds: r.data.player_ids,
      value: r.data.value,
    }))

    // Generate teams using Claude
    const generatedTeams = await generateTeams(players, ruleInputs)

    // Delete existing teams for this match
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('teams')
      .delete()
      .eq('match_id', matchId)

    // Create dark team
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: darkTeam, error: darkError } = await (supabase as any)
      .from('teams')
      .insert({
        match_id: matchId,
        name: 'dark',
        color_hex: '#1a1a1a',
        created_by_user_id: user.id,
      })
      .select('id')
      .single()

    if (darkError) {
      console.error('Error creating dark team:', darkError)
      throw darkError
    }

    // Create light team
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: lightTeam, error: lightError } = await (supabase as any)
      .from('teams')
      .insert({
        match_id: matchId,
        name: 'light',
        color_hex: '#ffffff',
        created_by_user_id: user.id,
      })
      .select('id')
      .single()

    if (lightError) {
      console.error('Error creating light team:', lightError)
      throw lightError
    }

    // Build a set of guest player IDs for assignment mapping
    const guestPlayerIds = new Set(
      signups.filter(s => s.guest_player_id).map(s => s.guest_players!.id)
    )

    // Create team assignments for dark team
    const darkAssignments = generatedTeams.dark.map((a, index) => ({
      team_id: darkTeam.id,
      player_id: guestPlayerIds.has(a.playerId) ? null : a.playerId,
      guest_player_id: guestPlayerIds.has(a.playerId) ? a.playerId : null,
      position: a.position,
      order_index: index,
      source: 'ai',
    }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: darkAssignError } = await (supabase as any)
      .from('team_assignments')
      .insert(darkAssignments)

    if (darkAssignError) {
      console.error('Error inserting dark team assignments:', darkAssignError)
      throw darkAssignError
    }

    // Create team assignments for light team
    const lightAssignments = generatedTeams.light.map((a, index) => ({
      team_id: lightTeam.id,
      player_id: guestPlayerIds.has(a.playerId) ? null : a.playerId,
      guest_player_id: guestPlayerIds.has(a.playerId) ? a.playerId : null,
      position: a.position,
      order_index: index,
      source: 'ai',
    }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: lightAssignError } = await (supabase as any)
      .from('team_assignments')
      .insert(lightAssignments)

    if (lightAssignError) {
      console.error('Error inserting light team assignments:', lightAssignError)
      throw lightAssignError
    }

    // Update match status to teams_created
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('matches')
      .update({ status: 'teams_created' })
      .eq('id', matchId)

    // Store AI reasoning as snapshot
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('matches')
      .update({
        ai_input_snapshot: {
          players: players.map((p) => ({ id: p.id, name: p.displayName, rating: p.overallRating })),
          reasoning: generatedTeams.reasoning,
          balanceScore: generatedTeams.balanceScore,
          warnings: generatedTeams.warnings,
          generatedAt: new Date().toISOString(),
        },
      })
      .eq('id', matchId)

    return NextResponse.json({
      success: true,
      teams: {
        dark: {
          id: darkTeam.id,
          assignments: generatedTeams.dark,
        },
        light: {
          id: lightTeam.id,
          assignments: generatedTeams.light,
        },
      },
      reasoning: generatedTeams.reasoning,
      balanceScore: generatedTeams.balanceScore,
      warnings: generatedTeams.warnings,
    })
  } catch (error) {
    console.error('Team generation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al generar equipos' },
      { status: 500 }
    )
  }
}
