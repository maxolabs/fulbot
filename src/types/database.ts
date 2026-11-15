// Database types.
//
// `database.generated.ts` is the verbatim output of
//   npx supabase gen types typescript --db-url "$LOCAL_DB_URL" --schema public > src/types/database.generated.ts
// run against a local database with every migration applied (last: 00031). Do not edit it by hand;
// regenerate it after each migration.
//
// This file re-exports it as `Database`, with the few overrides the generator cannot express
// (nullable RPC arguments, jsonb returns with a known shape), plus hand-written helper types.
//
// Note: group_memberships.member_score / member_breakdown / member_score_at / signup_cooldown are
// listed in the generated Row but are not SELECT-able by `authenticated` (00024 column grants).
// Read scores through get_member_scores() and never select('*') on group_memberships.
// removed_at / removed_by (00033) are not SELECT-able either: admins list ex-members through
// admin_list_removed_members().
import type { Database as GeneratedDatabase } from './database.generated'

export type { Json } from './database.generated'

type GeneratedPublic = GeneratedDatabase['public']
type GeneratedFunctions = GeneratedPublic['Functions']

/** Makes the listed arguments of a generated RPC accept null (SQL args without a default that are nullable). */
type WithNullableArgs<F extends keyof GeneratedFunctions, K extends keyof GeneratedFunctions[F]['Args']> = Omit<
  GeneratedFunctions[F],
  'Args'
> & {
  Args: Omit<GeneratedFunctions[F]['Args'], K> & { [P in K]: GeneratedFunctions[F]['Args'][P] | null }
}

type FunctionOverrides = {
  admin_set_match_result: WithNullableArgs<'admin_set_match_result', 'p_mvp_player_id'>
  submit_match_report: WithNullableArgs<'submit_match_report', 'p_dark_score' | 'p_light_score' | 'p_mvp_candidate_id'>
  member_scoring_settings: Omit<GeneratedFunctions['member_scoring_settings'], 'Returns'> & {
    Returns: MemberScoringSettings
  }
  // RETURNS TABLE columns come out non-null; the score columns are NULL for newcomers,
  // and member_breakdown is jsonb with a known shape.
  get_member_scores: Omit<GeneratedFunctions['get_member_scores'], 'Returns'> & {
    Returns: {
      group_id: string
      player_id: string
      is_active: boolean
      member_score: number | null
      member_breakdown: MemberBreakdown | null
      member_score_at: string | null
      signup_cooldown: boolean | null
    }[]
  }
}

export type Database = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<GeneratedPublic, 'Functions'> & {
    Functions: Omit<GeneratedFunctions, keyof FunctionOverrides> & FunctionOverrides
  }
}

// Member scoring (00021, docs/member-scoring.md §2, §10.1).
export type WaitlistReason = 'full' | 'priority_window' | 'reserved' | 'cooldown'

export interface MemberBreakdown {
  window_matches: number
  played: number
  is_new: boolean
  asistencia: { ratio: number; played: number; no_shows: number }
  aviso: { ratio: number; played: number; early: number; late: number }
  puntualidad: { ratio: number; late_arrivals: number }
  reglas: { ratio: number; wrong_jersey: number; unpaid: number }
  participacion: {
    ratio: number
    eligible: number
    participated: number
    reported: number
    rated: number
    voted_mvp: number
    newcomers_eligible: number
    newcomers_rated: number
  }
  /** Admin adjustments in stars (points / 20) */
  adjustments: number
  adjustment_points: number
  raw_points: number
}

export type MemberScoringPriorityMode = 'off' | 'window' | 'waitlist' | 'reserved'

/** Shape returned by member_scoring_settings(): groups.settings.member_scoring merged over defaults. */
export interface MemberScoringSettings {
  enabled: boolean
  window_matches: number
  late_cancel_hours: number
  min_matches_for_score: number
  weights: Record<string, number>
  dimensions: {
    asistencia: number
    aviso: number
    puntualidad: number
    reglas: number
    participacion: number
  }
  visibility: 'self' | 'group'
  priority: {
    mode: MemberScoringPriorityMode
    threshold: number
    window_hours: number
    reserved_spots: number
  }
  no_show_cooldown: boolean
  captains_can_report: boolean
}

// Convenience type exports
export type User = Database['public']['Tables']['users']['Row']
export type PlayerProfile = Database['public']['Tables']['player_profiles']['Row']
export type Group = Database['public']['Tables']['groups']['Row']
export type GroupMembership = Database['public']['Tables']['group_memberships']['Row']
export type Match = Database['public']['Tables']['matches']['Row']
export type RecurringPattern = Database['public']['Tables']['recurring_patterns']['Row']
export type GuestPlayer = Database['public']['Tables']['guest_players']['Row']
export type MatchSignup = Database['public']['Tables']['match_signups']['Row']
export type Team = Database['public']['Tables']['teams']['Row']
export type TeamAssignment = Database['public']['Tables']['team_assignments']['Row']
export type MatchRating = Database['public']['Tables']['match_ratings']['Row']
export type MatchMVPVote = Database['public']['Tables']['match_mvp_votes']['Row']
export type RuleSet = Database['public']['Tables']['rule_sets']['Row']
export type NotificationSettings = Database['public']['Tables']['notification_settings']['Row']
export type PlayerBadge = Database['public']['Tables']['player_badges']['Row']
export type MatchEvent = Database['public']['Tables']['match_events']['Row']
export type Notification = Database['public']['Tables']['notifications']['Row']
export type NotificationRead = Database['public']['Tables']['notification_reads']['Row']
export type NotificationOutboxRow = Database['public']['Tables']['notification_outbox']['Row']
export type ScheduledJob = Database['public']['Tables']['scheduled_jobs']['Row']
export type SchedulerState = Database['public']['Tables']['scheduler_state']['Row']
export type MatchReport = Database['public']['Tables']['match_reports']['Row']
export type MatchReportStat = Database['public']['Tables']['match_report_stats']['Row']
export type MemberEvent = Database['public']['Tables']['member_events']['Row']
export type MemberEventType = Database['public']['Enums']['member_event_type']
export type MemberEventSource = Database['public']['Enums']['member_event_source']
export type MatchResultStatus = Database['public']['Tables']['matches']['Row']['result_status']

// Shapes of the jsonb arguments of the report/result RPCs (00020).
export interface MatchReportStatInput {
  team_id: string
  player_id?: string | null
  guest_player_id?: string | null
  goals?: number
  assists?: number
}
export interface AdminMatchEventInput {
  team_id: string
  player_id?: string | null
  guest_player_id?: string | null
  event_type: 'goal' | 'assist' | 'own_goal'
  /** 0-based index of the goal this assist belongs to, within the same p_events array */
  linked_index?: number | null
}

// Type for group with role
export type GroupWithRole = Group & {
  role: 'admin' | 'captain' | 'member'
}

// Type for signup with player info
export type SignupWithPlayer = MatchSignup & {
  player?: PlayerProfile
  guest_player?: GuestPlayer
}

// Type for team with assignments
export type TeamWithAssignments = Team & {
  assignments: (TeamAssignment & {
    player?: PlayerProfile
    guest_player?: GuestPlayer
  })[]
}
