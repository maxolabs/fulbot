import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  generateTeams,
  guestPlayerDefaults,
  PlayerInput,
  RuleInput,
  MatchHistoryEntry,
} from '@/lib/ai/team-generator'
import type { Json } from '@/types/database'

interface RouteContext {
  params: Promise<{ matchId: string }>
}

const KNOWN_RULE_TYPES = new Set<RuleInput['type']>([
  'avoid_pair',
  'force_pair',
  'min_goalkeepers',
  'min_defenders',
])

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
      .single()

    if (!playerProfile) {
      return NextResponse.json({ error: 'Perfil no encontrado' }, { status: 400 })
    }

    // Get match with group info
    const { data: match } = await supabase
      .from('matches')
      .select('id, group_id, status, max_players')
      .eq('id', matchId)
      .single()

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
      .single()

    if (!membership || (membership.role !== 'admin' && membership.role !== 'captain')) {
      return NextResponse.json({ error: 'No tenés permiso para armar equipos en este grupo' }, { status: 403 })
    }

    // Get confirmed signups with player profiles and guest players.
    // The hand-written Database type doesn't carry FK relationship metadata, so the
    // client can't infer the shape of this embedded select on its own - we assert the
    // known shape here instead (same pattern used elsewhere in this codebase).
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
        estimated_rating: number
        preferred_positions: string[]
      } | null
    }

    const { data: signups, error: signupsError } = await supabase
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
          display_name,
          estimated_rating,
          preferred_positions
        )
      `)
      .eq('match_id', matchId)
      .eq('status', 'confirmed') as unknown as {
        data: SignupWithPlayer[] | null
        error: { message: string } | null
      }

    if (signupsError) {
      console.error('Error fetching signups:', signupsError)
      return NextResponse.json({ error: 'No se pudieron obtener los jugadores anotados' }, { status: 500 })
    }

    if (!signups || signups.length < 4) {
      return NextResponse.json(
        { error: 'Se necesitan al menos 4 jugadores confirmados para armar equipos' },
        { status: 400 }
      )
    }

    // Convert to PlayerInput format (registered players + guests)
    const players: PlayerInput[] = signups
      .filter((s) => s.player_profiles !== null || s.guest_players !== null)
      .map((s) => {
        if (s.player_profiles) {
          const pp = s.player_profiles
          return {
            id: pp.id,
            displayName: pp.display_name,
            nickname: pp.nickname,
            mainPosition: pp.main_position,
            preferredPositions: pp.preferred_positions,
            overallRating: pp.overall_rating,
            footedness: pp.footedness,
            goalkeeperWillingness: pp.goalkeeper_willingness,
            fitnessStatus: pp.fitness_status,
            reliabilityScore: pp.reliability_score,
            matchesPlayed: pp.matches_played,
            goals: pp.goals,
            assists: pp.assists,
          }
        }
        const gp = s.guest_players!
        return guestPlayerDefaults({
          id: gp.id,
          displayName: gp.display_name,
          preferredPositions: gp.preferred_positions,
          estimatedRating: gp.estimated_rating,
        })
      })

    // Guest player ids, used later to split assignments between player_id / guest_player_id
    const guestPlayerIds = new Set(
      signups.filter((s) => s.guest_player_id && s.guest_players).map((s) => s.guest_players!.id)
    )

    // Get rules for this group/match (canonical shapes only, see docs/rework-plan.md §2.2)
    const { data: rules } = await supabase
      .from('rule_sets')
      .select('rule_type, data')
      .or(`group_id.eq.${match.group_id},match_id.eq.${matchId}`)
      .eq('is_active', true)

    const ruleInputs: RuleInput[] = (rules || [])
      .filter((r) => KNOWN_RULE_TYPES.has(r.rule_type as RuleInput['type']))
      .map((r) => {
        const d = (r.data ?? {}) as { player_ids?: string[]; min_count?: number }
        return {
          type: r.rule_type as RuleInput['type'],
          playerIds: d.player_ids,
          value: d.min_count,
        }
      })

    // Recent match history, for teammate-pair rotation
    const { data: historyRows } = await supabase.rpc('get_recent_match_history', {
      p_group_id: match.group_id,
      p_limit: 5,
    })

    const historyEntries: MatchHistoryEntry[] = (historyRows || []).map((row) => ({
      matchId: row.match_id,
      matchDate: row.match_date,
      darkTeamPlayers: (row.dark_team_players as { player_id: string; name: string }[] | null) ?? null,
      lightTeamPlayers: (row.light_team_players as { player_id: string; name: string }[] | null) ?? null,
    }))

    // Generate teams (OpenAI with hard-constraint validation, falls back to the
    // deterministic balancer when the key is missing or the AI keeps failing)
    const teamSize = Math.ceil(players.length / 2)
    const generatedTeams = await generateTeams(players, ruleInputs, teamSize, historyEntries)

    // Persist teams + assignments atomically through the shared RPC (also used by
    // manual drag/drop edits), then update match status + AI snapshot.
    const assignmentsPayload = [
      ...generatedTeams.dark.map((a, index) => ({
        team: 'dark' as const,
        player_id: guestPlayerIds.has(a.playerId) ? null : a.playerId,
        guest_player_id: guestPlayerIds.has(a.playerId) ? a.playerId : null,
        position: a.position,
        order_index: index,
        source: 'ai' as const,
      })),
      ...generatedTeams.light.map((a, index) => ({
        team: 'light' as const,
        player_id: guestPlayerIds.has(a.playerId) ? null : a.playerId,
        guest_player_id: guestPlayerIds.has(a.playerId) ? a.playerId : null,
        position: a.position,
        order_index: index,
        source: 'ai' as const,
      })),
    ]

    const { error: saveError } = await supabase.rpc('save_team_assignments', {
      p_match_id: matchId,
      p_assignments: assignmentsPayload as unknown as Json,
    })

    if (saveError) {
      console.error('Error saving team assignments:', saveError)
      return NextResponse.json(
        { error: 'No se pudieron guardar los equipos generados. Probá de nuevo.' },
        { status: 500 }
      )
    }

    const { data: teams } = await supabase
      .from('teams')
      .select('id, name')
      .eq('match_id', matchId)

    const darkTeamId = teams?.find((t) => t.name === 'dark')?.id ?? null
    const lightTeamId = teams?.find((t) => t.name === 'light')?.id ?? null

    const generatedAt = new Date().toISOString()
    const snapshot = {
      input: {
        players: players.map((p) => ({
          id: p.id,
          name: p.displayName,
          rating: p.overallRating,
          isGuest: p.isGuest ?? false,
        })),
        rules: ruleInputs,
        recentMatchesConsidered: historyEntries.length,
      },
      output: {
        dark: generatedTeams.dark,
        light: generatedTeams.light,
        reasoning: generatedTeams.reasoning,
        balanceScore: generatedTeams.balanceScore,
        warnings: generatedTeams.warnings,
      },
      provider: generatedTeams.provider,
      model: generatedTeams.model ?? null,
      generatedAt,
    } as unknown as Json

    const { error: updateError } = await supabase
      .from('matches')
      .update({
        status: 'teams_created',
        ai_input_snapshot: snapshot,
      })
      .eq('id', matchId)

    if (updateError) {
      console.error('Error updating match after team generation:', updateError)
      // The teams were already saved, so this is a soft failure - keep going.
    }

    return NextResponse.json({
      success: true,
      teams: {
        dark: {
          id: darkTeamId,
          assignments: generatedTeams.dark,
        },
        light: {
          id: lightTeamId,
          assignments: generatedTeams.light,
        },
      },
      reasoning: generatedTeams.reasoning,
      balanceScore: generatedTeams.balanceScore,
      warnings: generatedTeams.warnings,
      provider: generatedTeams.provider,
    })
  } catch (error) {
    console.error('Team generation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al generar equipos. Probá de nuevo en un momento.' },
      { status: 500 }
    )
  }
}
