import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  generateTeams,
  guestPlayerDefaults,
  MEMBER_SCORE_NEUTRAL,
  PlayerInput,
  RuleInput,
  MatchHistoryEntry,
  PreviousLineup,
} from '@/lib/ai/team-generator'
import type { Json } from '@/types/database'
import { getT, type Language } from '@/i18n/server'
import { overallOf, skillsOf, summariesById, RATING_SUMMARY_COLUMNS, type RatingSummary } from '@/lib/ratings'
import { rulesForPlayers } from '@/lib/ai/constraints'

// The OpenAI attempts stop at ~25s (team-generator.ts) and the fallback runs
// after that, so the whole request fits in a minute.
export const maxDuration = 60

interface RouteContext {
  params: Promise<{ matchId: string }>
}

// publish_match_teams raises Spanish messages meant for logs; the client gets
// a translated key instead (never the raw database error).
function publishErrorKey(message: string): string {
  if (message.includes('La lista de confirmados cambió') || message.includes('Asignaciones inválidas')) return 'rosterChanged'
  if (message.includes('No tenés permiso')) return 'forbidden'
  if (message.includes('no permite modificar')) return 'notAllowed'
  if (message.includes('al menos 4')) return 'needPlayers'
  return 'saveFailed'
}

const KNOWN_RULE_TYPES = new Set<RuleInput['type']>([
  'avoid_pair',
  'force_pair',
  'min_goalkeepers',
  'min_defenders',
])

export async function POST(request: NextRequest, context: RouteContext) {
  // Spanish until we know who is asking (the app's default language)
  let t = getT('es')
  const fail = (key: string, status: number) =>
    NextResponse.json({ error: t(`ui.teamsAi.errors.${key}`) }, { status })
  try {
    const { matchId } = await context.params
    const supabase = await createClient()

    // Check authentication
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return fail('unauthorized', 401)
    }

    // Errors and the AI's reasoning/warnings come back in the caller's language
    const { data: userData } = await supabase
      .from('users')
      .select('preferred_language')
      .eq('id', user.id)
      .single() as { data: { preferred_language: Language } | null }
    const language: Language = userData?.preferred_language === 'en' ? 'en' : 'es'
    t = getT(language)

    // Get user's player profile
    const { data: playerProfile } = await supabase
      .from('player_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!playerProfile) {
      return fail('profileNotFound', 400)
    }

    // Get match with group info
    const { data: match } = await supabase
      .from('matches')
      .select('id, group_id, status, max_players')
      .eq('id', matchId)
      .single()

    if (!match) {
      return fail('matchNotFound', 404)
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
      return fail('forbidden', 403)
    }

    if (!match.status || !['signup_open', 'full', 'signup_closed', 'teams_created'].includes(match.status)) {
      return fail('notAllowed', 409)
    }

    // Get confirmed signups with player profiles and guest players.
    // Asserts the known shape: several profile columns are nullable in the schema
    // (DEFAULT without NOT NULL) but always set in practice.
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
        footedness: 'left' | 'right' | 'both'
        goalkeeper_willingness: number
        fitness_status: 'ok' | 'limited' | 'injured'
        matches_played: number
        goals: number
        assists: number
      } | null
      guest_players: {
        id: string
        display_name: string
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
          footedness,
          goalkeeper_willingness,
          fitness_status,
          matches_played,
          goals,
          assists
        ),
        guest_players (
          id,
          display_name,
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
      return fail('signupsFailed', 500)
    }

    if (!signups || signups.length < 4) {
      return fail('needPlayers', 400)
    }

    // Scores come from player_rating_summary (peer ratings blended with post-match
    // ratings), this group's row only (OD-9): a level earned in another group
    // says little here. The caller is an admin/captain, so RLS lets them read it.
    const ratedIds = signups
      .map((s) => s.player_profiles?.id)
      .filter((id): id is string => !!id)
    const { data: summaryRows } = ratedIds.length > 0
      ? await supabase
          .from('player_rating_summary')
          .select(RATING_SUMMARY_COLUMNS)
          .eq('group_id', match.group_id)
          .in('player_id', ratedIds) as { data: RatingSummary[] | null }
      : { data: [] as RatingSummary[] }
    const summaries = summariesById(summaryRows)

    // Member score ("Compromiso") of each registered player in the match's group
    // (docs/member-scoring.md §5.3). NULL (newcomer) and guests fall back to neutral.
    // The score columns are not selectable (00029): get_member_scores returns
    // every row of the group to an admin/captain, which the caller is.
    const { data: membershipRows } = ratedIds.length > 0
      ? await supabase.rpc('get_member_scores', { p_group_id: match.group_id })
      : { data: [] }
    const memberScoreById = new Map(
      (membershipRows || []).map((m) => [m.player_id, m.member_score === null ? null : Number(m.member_score)])
    )

    // Guest levels are organizer-only columns (00035); the caller is one.
    const guestRatingById = new Map<string, number | null>()
    if (signups.some((s) => s.guest_players)) {
      const { data: guestRows } = await supabase.rpc('get_match_guest_ratings', { p_match_id: matchId })
      for (const row of guestRows || []) {
        guestRatingById.set(row.guest_player_id, row.estimated_rating === null ? null : Number(row.estimated_rating))
      }
    }

    // Convert to PlayerInput format (registered players + guests)
    const players: PlayerInput[] = signups
      .filter((s) => s.player_profiles !== null || s.guest_players !== null)
      .map((s) => {
        if (s.player_profiles) {
          const pp = s.player_profiles
          const summary = summaries.get(pp.id)
          return {
            id: pp.id,
            displayName: pp.display_name,
            nickname: pp.nickname,
            mainPosition: pp.main_position,
            preferredPositions: pp.preferred_positions,
            overallRating: overallOf(summary),
            skills: skillsOf(summary),
            tags: summary?.tags ?? [],
            footedness: pp.footedness,
            goalkeeperWillingness: pp.goalkeeper_willingness,
            fitnessStatus: pp.fitness_status,
            memberScore: memberScoreById.get(pp.id) ?? MEMBER_SCORE_NEUTRAL,
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
          estimatedRating: guestRatingById.get(gp.id) ?? null,
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

    // Pair rules about players who aren't in this match are dropped (they would
    // reach the prompt and the snapshot as raw ids).
    const ruleInputs: RuleInput[] = rulesForPlayers(players, (rules || [])
      .filter((r) => KNOWN_RULE_TYPES.has(r.rule_type as RuleInput['type']))
      .map((r) => {
        const d = (r.data ?? {}) as { player_ids?: string[]; min_count?: number }
        return {
          type: r.rule_type as RuleInput['type'],
          playerIds: d.player_ids,
          value: d.min_count,
        }
      }))

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

    // "Regenerar": the lineup already published, so the new proposal can differ
    // from it (the model is told to, the fallback draws a varied candidate).
    const { data: currentTeams } = await supabase
      .from('teams')
      .select('id, name')
      .eq('match_id', matchId) as { data: { id: string; name: 'dark' | 'light' }[] | null }
    let previous: PreviousLineup | null = null
    if (currentTeams && currentTeams.length > 0) {
      const { data: currentAssignments } = await supabase
        .from('team_assignments')
        .select('team_id, player_id, guest_player_id')
        .in('team_id', currentTeams.map((team) => team.id)) as {
          data: { team_id: string; player_id: string | null; guest_player_id: string | null }[] | null
        }
      const idsOf = (name: 'dark' | 'light') => {
        const teamId = currentTeams.find((team) => team.name === name)?.id
        return (currentAssignments || [])
          .filter((a) => a.team_id === teamId)
          .map((a) => a.player_id ?? a.guest_player_id)
          .filter((id): id is string => !!id)
      }
      previous = { dark: idsOf('dark'), light: idsOf('light') }
    }

    // Generate teams (OpenAI with hard-constraint validation, falls back to the
    // rule-based balancer when the key is missing or the AI keeps failing)
    const teamSize = Math.ceil(players.length / 2)
    const generatedTeams = await generateTeams(players, ruleInputs, teamSize, historyEntries, {
      language,
      previous,
      seed: previous ? Math.floor(Math.random() * 2 ** 31) : undefined,
    })

    // Persist teams + assignments atomically through the shared RPC (also used by
    // manual drag/drop edits), which also sets the status and stores the snapshot.
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

    // What the organizer analysis card shows, and nothing else (OD-6): the
    // snapshot lives in match_ai_snapshots (admins and captains only), and
    // publish_match_teams whitelists the same fields again, so ratings, member
    // scores and the prompt never reach the database. A manual publish
    // (draggable-teams) sends NULL, which removes it: the analysis describes
    // the AI lineup, not one rearranged by hand.
    const snapshot = {
      output: {
        reasoning: generatedTeams.reasoning,
        balanceScore: generatedTeams.balanceScore,
        warnings: generatedTeams.warnings,
      },
      provider: generatedTeams.provider,
      model: generatedTeams.model ?? null,
      generatedAt: new Date().toISOString(),
    } as unknown as Json

    const { error: saveError } = await supabase.rpc('publish_match_teams', {
      p_match_id: matchId,
      p_assignments: assignmentsPayload as unknown as Json,
      p_snapshot: snapshot,
    })
    if (saveError) {
      console.error('publish_match_teams failed:', saveError)
      return fail(publishErrorKey(saveError.message), 409)
    }
    const { data: teams } = await supabase.from('teams').select('id, name').eq('match_id', matchId)
    const darkTeamId = teams?.find((team) => team.name === 'dark')?.id ?? null
    const lightTeamId = teams?.find((team) => team.name === 'light')?.id ?? null

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
    return fail('generic', 500)
  }
}
