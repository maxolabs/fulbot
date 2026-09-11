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

export const NOTIFICATION_TYPES: NotificationType[] = [
  'match_created',
  'waitlist_promoted',
  'teams_created',
  'match_reminder',
  'results_posted',
  'rate_new_member',
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

export interface ResultsPostedPayload {
  match_id: string
  dark_score: number
  light_score: number
}

// Emitted by a trigger on group_memberships (00017_peer_ratings.sql) when someone
// joins or is reactivated; group-wide, in-app only (never to the WhatsApp outbox).
export interface RateNewMemberPayload {
  player_id: string
  player_name: string
}

export interface NotificationPayloadMap {
  match_created: MatchCreatedPayload
  waitlist_promoted: WaitlistPromotedPayload
  teams_created: TeamsCreatedPayload
  match_reminder: MatchReminderPayload
  results_posted: ResultsPostedPayload
  rate_new_member: RateNewMemberPayload
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

export interface NotificationRow {
  id: string
  group_id: string
  match_id: string | null
  recipient_player_id: string | null
  type: NotificationType
  payload: NotificationPayloadMap[NotificationType]
  created_at: string
}
