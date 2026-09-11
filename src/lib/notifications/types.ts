// T5 notifications: shared event/payload shapes (see docs/rework-plan.md §2.6).
// Kept independent from src/types/database.ts because `notifications.type` and
// `notifications.payload` are plain text/jsonb columns -- these types describe
// the canonical shapes emit_notification() and the callers in app code agree on.

export type NotificationType =
  | 'match_created'
  | 'waitlist_promoted'
  | 'teams_created'
  | 'match_reminder'
  | 'results_posted'
  | 'rate_new_member'
  | 'results_request'
  | 'results_reminder'
  | 'results_needs_review'
  | 'results_changed'

export const NOTIFICATION_TYPES: NotificationType[] = [
  'match_created',
  'waitlist_promoted',
  'teams_created',
  'match_reminder',
  'results_posted',
  'rate_new_member',
  'results_request',
  'results_reminder',
  'results_needs_review',
  'results_changed',
]

export interface MatchCreatedPayload {
  match_id: string
  group_name: string
  date_time: string // ISO timestamp
  location: string | null
  max_players: number
  signup_url: string
}

export interface WaitlistPromotedPayload {
  signup_id: string
  player_name: string
  // Present only when the promoted signup belongs to a registered player
  // (not a guest) -- emit_notification() reads this key to set
  // notifications.recipient_player_id.
  recipient_player_id: string | null
}

export interface TeamsCreatedPayload {
  match_id: string
  dark_team_names: string[]
  light_team_names: string[]
}

export interface MatchReminderPayload {
  match_id: string
  group_name: string
  time: string // "HH:MM" in the group's timezone
  location: string | null
}

// Crowd-sourced results (docs/match-results-consensus.md §11.1). Emitted from
// SQL by recompute_match_consensus / admin_set_match_result; the pre-consensus
// shape only had match_id + scores, so every extra field is optional here and
// the template degrades to "Oscuro X - Claro Y" for old rows.
export interface ResultsPostedPayload {
  match_id: string
  dark_score: number
  light_score: number
  scorers?: { name: string; team: 'dark' | 'light'; goals: number }[]
  assisters?: { name: string; team: 'dark' | 'light'; assists: number }[]
  unattributed?: { dark: number; light: number }
  mvp_name?: string | null
  mvp_player_id?: string | null
  status?: 'consensus' | 'locked'
}

// Sent by the `results_request` scheduled job once the match is finished and
// the admin's per-match delay has elapsed. report_url may be stored relative
// (the SQL layer has no app URL); resolveReportUrl() prefixes it at render time.
export interface ResultsRequestPayload {
  match_id: string
  group_name: string
  date_time: string // ISO timestamp
  report_url: string
  // Confirmed registered players of the match. The row is group-wide (one
  // WhatsApp message); the /notifications page shows it only to these ids.
  // Absent on rows emitted before the field existed -> shown to everyone.
  player_ids?: string[]
}

// One group-wide row per match (never one per player): the list of players
// who still haven't reported. The /notifications page shows it only to users
// whose player id is in pending_player_ids; WhatsApp gets a single message.
export interface ResultsReminderPayload {
  match_id: string
  group_name: string
  date_time: string // ISO timestamp
  report_url: string
  pending_player_ids: string[]
  pending_player_names: string[]
}

// In-app only (no outbox row), one per group admin with recipient_player_id
// set, when the reporting window closed without a single report.
export interface ResultsNeedsReviewPayload {
  match_id: string
  group_name: string
  date_time: string // ISO timestamp
  reports_count: number
}

// Emitted by a trigger on group_memberships (00018_peer_ratings.sql) when someone
// joins or is reactivated; group-wide, in-app only (never to the WhatsApp outbox).
export interface RateNewMemberPayload {
  player_id: string
  player_name: string
}

// In-app only, one row per group admin (recipient_player_id set): the
// consensus changed after the result was already posted to the group
// (docs/match-results-consensus.md §5.4, §7). previous/current are "dark-light".
export interface ResultsChangedPayload {
  match_id: string
  group_name: string
  date_time: string // ISO timestamp
  // Internal keys ("dark-light|mvp_id"): what the admin last saw vs now.
  previous: string
  current: string
  // Display strings ("4-1").
  previous_score: string
  current_score: string
  mvp_name?: string | null
}

export interface NotificationPayloadMap {
  match_created: MatchCreatedPayload
  waitlist_promoted: WaitlistPromotedPayload
  teams_created: TeamsCreatedPayload
  match_reminder: MatchReminderPayload
  results_posted: ResultsPostedPayload
  rate_new_member: RateNewMemberPayload
  results_request: ResultsRequestPayload
  results_reminder: ResultsReminderPayload
  results_needs_review: ResultsNeedsReviewPayload
  results_changed: ResultsChangedPayload
}

// Discriminated union so templates.ts (and anything else switching on `type`)
// gets real exhaustiveness checking from TypeScript.
export type NotificationEvent =
  | { type: 'match_created'; payload: MatchCreatedPayload }
  | { type: 'waitlist_promoted'; payload: WaitlistPromotedPayload }
  | { type: 'teams_created'; payload: TeamsCreatedPayload }
  | { type: 'match_reminder'; payload: MatchReminderPayload }
  | { type: 'results_posted'; payload: ResultsPostedPayload }
  | { type: 'rate_new_member'; payload: RateNewMemberPayload }
  | { type: 'results_request'; payload: ResultsRequestPayload }
  | { type: 'results_reminder'; payload: ResultsReminderPayload }
  | { type: 'results_needs_review'; payload: ResultsNeedsReviewPayload }
  | { type: 'results_changed'; payload: ResultsChangedPayload }

export interface NotificationRow {
  id: string
  group_id: string
  match_id: string | null
  recipient_player_id: string | null
  type: NotificationType
  payload: NotificationPayloadMap[NotificationType]
  created_at: string
}
