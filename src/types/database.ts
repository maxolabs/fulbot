export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          name: string
          avatar_url: string | null
          preferred_language: 'es' | 'en'
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          name: string
          avatar_url?: string | null
          preferred_language?: 'es' | 'en'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          name?: string
          avatar_url?: string | null
          preferred_language?: 'es' | 'en'
          created_at?: string
          updated_at?: string
        }
      }
      player_profiles: {
        Row: {
          id: string
          user_id: string | null
          display_name: string
          nickname: string | null
          preferred_positions: string[]
          main_position: string
          footedness: 'left' | 'right' | 'both'
          goalkeeper_willingness: number
          reliability_score: number
          fitness_status: 'ok' | 'limited' | 'injured'
          overall_rating: number
          matches_played: number
          goals: number
          assists: number
          mvp_count: number
          clean_sheets: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          display_name: string
          nickname?: string | null
          preferred_positions?: string[]
          main_position?: string
          footedness?: 'left' | 'right' | 'both'
          goalkeeper_willingness?: number
          reliability_score?: number
          fitness_status?: 'ok' | 'limited' | 'injured'
          overall_rating?: number
          matches_played?: number
          goals?: number
          assists?: number
          mvp_count?: number
          clean_sheets?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          display_name?: string
          nickname?: string | null
          preferred_positions?: string[]
          main_position?: string
          footedness?: 'left' | 'right' | 'both'
          goalkeeper_willingness?: number
          reliability_score?: number
          fitness_status?: 'ok' | 'limited' | 'injured'
          overall_rating?: number
          matches_played?: number
          goals?: number
          assists?: number
          mvp_count?: number
          clean_sheets?: number
          created_at?: string
          updated_at?: string
        }
      }
      groups: {
        Row: {
          id: string
          name: string
          slug: string
          description: string | null
          default_match_day: number | null
          default_match_time: string | null
          default_max_players: number
          timezone: string
          created_by_user_id: string | null
          settings: Json
          invite_code: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          description?: string | null
          default_match_day?: number | null
          default_match_time?: string | null
          default_max_players?: number
          timezone?: string
          created_by_user_id?: string | null
          settings?: Json
          invite_code?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          description?: string | null
          default_match_day?: number | null
          default_match_time?: string | null
          default_max_players?: number
          timezone?: string
          created_by_user_id?: string | null
          settings?: Json
          invite_code?: string
          created_at?: string
          updated_at?: string
        }
      }
      group_memberships: {
        Row: {
          id: string
          group_id: string
          player_id: string
          role: 'admin' | 'captain' | 'member'
          is_active: boolean
          joined_at: string
        }
        Insert: {
          id?: string
          group_id: string
          player_id: string
          role?: 'admin' | 'captain' | 'member'
          is_active?: boolean
          joined_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          player_id?: string
          role?: 'admin' | 'captain' | 'member'
          is_active?: boolean
          joined_at?: string
        }
      }
      matches: {
        Row: {
          id: string
          group_id: string
          date_time: string
          location: string | null
          status: 'draft' | 'signup_open' | 'full' | 'teams_created' | 'finished' | 'cancelled'
          max_players: number
          recurring_pattern_id: string | null
          ai_input_snapshot: Json | null
          notes: string | null
          results_finalized: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          group_id: string
          date_time: string
          location?: string | null
          status?: 'draft' | 'signup_open' | 'full' | 'teams_created' | 'finished' | 'cancelled'
          max_players?: number
          recurring_pattern_id?: string | null
          ai_input_snapshot?: Json | null
          notes?: string | null
          results_finalized?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          date_time?: string
          location?: string | null
          status?: 'draft' | 'signup_open' | 'full' | 'teams_created' | 'finished' | 'cancelled'
          max_players?: number
          recurring_pattern_id?: string | null
          ai_input_snapshot?: Json | null
          notes?: string | null
          results_finalized?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      guest_players: {
        Row: {
          id: string
          display_name: string
          notes: string | null
          estimated_rating: number
          preferred_positions: string[]
          created_by_user_id: string | null
          group_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          display_name: string
          notes?: string | null
          estimated_rating?: number
          preferred_positions?: string[]
          created_by_user_id?: string | null
          group_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          display_name?: string
          notes?: string | null
          estimated_rating?: number
          preferred_positions?: string[]
          created_by_user_id?: string | null
          group_id?: string | null
          created_at?: string
        }
      }
      match_signups: {
        Row: {
          id: string
          match_id: string
          player_id: string | null
          guest_player_id: string | null
          status: 'confirmed' | 'waitlist' | 'cancelled' | 'did_not_show'
          signup_time: string
          cancel_time: string | null
          position_preference: string | null
          notes: string | null
          waitlist_position: number | null
        }
        Insert: {
          id?: string
          match_id: string
          player_id?: string | null
          guest_player_id?: string | null
          status?: 'confirmed' | 'waitlist' | 'cancelled' | 'did_not_show'
          signup_time?: string
          cancel_time?: string | null
          position_preference?: string | null
          notes?: string | null
          waitlist_position?: number | null
        }
        Update: {
          id?: string
          match_id?: string
          player_id?: string | null
          guest_player_id?: string | null
          status?: 'confirmed' | 'waitlist' | 'cancelled' | 'did_not_show'
          signup_time?: string
          cancel_time?: string | null
          position_preference?: string | null
          notes?: string | null
          waitlist_position?: number | null
        }
      }
      teams: {
        Row: {
          id: string
          match_id: string
          name: 'dark' | 'light'
          color_hex: string
          score: number
          created_by_user_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          match_id: string
          name: 'dark' | 'light'
          color_hex?: string
          score?: number
          created_by_user_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          match_id?: string
          name?: 'dark' | 'light'
          color_hex?: string
          score?: number
          created_by_user_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      team_assignments: {
        Row: {
          id: string
          team_id: string
          player_id: string | null
          guest_player_id: string | null
          position: string
          order_index: number
          source: 'ai' | 'manual'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          team_id: string
          player_id?: string | null
          guest_player_id?: string | null
          position: string
          order_index?: number
          source?: 'ai' | 'manual'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          team_id?: string
          player_id?: string | null
          guest_player_id?: string | null
          position?: string
          order_index?: number
          source?: 'ai' | 'manual'
          created_at?: string
          updated_at?: string
        }
      }
      match_ratings: {
        Row: {
          id: string
          match_id: string
          voter_player_id: string
          rated_player_id: string
          rating: number
          comment: string | null
          created_at: string
        }
        Insert: {
          id?: string
          match_id: string
          voter_player_id: string
          rated_player_id: string
          rating: number
          comment?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          match_id?: string
          voter_player_id?: string
          rated_player_id?: string
          rating?: number
          comment?: string | null
          created_at?: string
        }
      }
      match_mvp_votes: {
        Row: {
          id: string
          match_id: string
          voter_player_id: string
          candidate_player_id: string
          created_at: string
        }
        Insert: {
          id?: string
          match_id: string
          voter_player_id: string
          candidate_player_id: string
          created_at?: string
        }
        Update: {
          id?: string
          match_id?: string
          voter_player_id?: string
          candidate_player_id?: string
          created_at?: string
        }
      }
      rule_sets: {
        Row: {
          id: string
          group_id: string | null
          match_id: string | null
          rule_type: 'avoid_pair' | 'force_pair' | 'min_defenders' | 'min_goalkeepers' | 'balance_rating'
          data: Json
          is_active: boolean
          created_by_user_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          group_id?: string | null
          match_id?: string | null
          rule_type: 'avoid_pair' | 'force_pair' | 'min_defenders' | 'min_goalkeepers' | 'balance_rating'
          data?: Json
          is_active?: boolean
          created_by_user_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          group_id?: string | null
          match_id?: string | null
          rule_type?: 'avoid_pair' | 'force_pair' | 'min_defenders' | 'min_goalkeepers' | 'balance_rating'
          data?: Json
          is_active?: boolean
          created_by_user_id?: string | null
          created_at?: string
        }
      }
      notification_settings: {
        Row: {
          id: string
          group_id: string
          send_signup_link_on_create: boolean
          reminder_hours_before: number
          notify_on_waitlist_promotion: boolean
          notify_on_teams_created: boolean
          whatsapp_webhook_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          group_id: string
          send_signup_link_on_create?: boolean
          reminder_hours_before?: number
          notify_on_waitlist_promotion?: boolean
          notify_on_teams_created?: boolean
          whatsapp_webhook_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          send_signup_link_on_create?: boolean
          reminder_hours_before?: number
          notify_on_waitlist_promotion?: boolean
          notify_on_teams_created?: boolean
          whatsapp_webhook_url?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      player_badges: {
        Row: {
          id: string
          player_id: string
          badge_type: string
          earned_at: string
          match_id: string | null
          metadata: Json
        }
        Insert: {
          id?: string
          player_id: string
          badge_type: string
          earned_at?: string
          match_id?: string | null
          metadata?: Json
        }
        Update: {
          id?: string
          player_id?: string
          badge_type?: string
          earned_at?: string
          match_id?: string | null
          metadata?: Json
        }
      }
      match_events: {
        Row: {
          id: string
          match_id: string
          team_id: string
          player_id: string | null
          guest_player_id: string | null
          event_type: 'goal' | 'assist' | 'own_goal'
          linked_event_id: string | null
          minute: number | null
          created_at: string
        }
        Insert: {
          id?: string
          match_id: string
          team_id: string
          player_id?: string | null
          guest_player_id?: string | null
          event_type: 'goal' | 'assist' | 'own_goal'
          linked_event_id?: string | null
          minute?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          match_id?: string
          team_id?: string
          player_id?: string | null
          guest_player_id?: string | null
          event_type?: 'goal' | 'assist' | 'own_goal'
          linked_event_id?: string | null
          minute?: number | null
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      process_match_signup: {
        Args: {
          p_match_id: string
          p_player_id: string
          p_notes?: string
          p_position_preference?: string
        }
        Returns: Database['public']['Tables']['match_signups']['Row']
      }
      cancel_match_signup: {
        Args: {
          p_match_id: string
          p_player_id: string
        }
        Returns: {
          cancelled_signup: Database['public']['Tables']['match_signups']['Row']
          promoted_signup: Database['public']['Tables']['match_signups']['Row'] | null
        }[]
      }
      create_group_with_admin: {
        Args: {
          p_name: string
          p_slug: string
          p_description?: string
          p_default_match_day?: number
          p_default_match_time?: string
          p_default_max_players?: number
        }
        Returns: Database['public']['Tables']['groups']['Row']
      }
      join_group_via_invite: {
        Args: {
          p_invite_code: string
        }
        Returns: Database['public']['Tables']['group_memberships']['Row']
      }
      get_current_player_id: {
        Args: Record<string, never>
        Returns: string
      }
      is_group_member: {
        Args: {
          group_uuid: string
        }
        Returns: boolean
      }
      is_group_admin: {
        Args: {
          group_uuid: string
        }
        Returns: boolean
      }
      is_group_admin_or_captain: {
        Args: {
          group_uuid: string
        }
        Returns: boolean
      }
      finalize_match_results: {
        Args: {
          p_match_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      user_language: 'es' | 'en'
      footedness: 'left' | 'right' | 'both'
      fitness_status: 'ok' | 'limited' | 'injured'
      group_role: 'admin' | 'captain' | 'member'
      match_status: 'draft' | 'signup_open' | 'full' | 'teams_created' | 'finished' | 'cancelled'
      signup_status: 'confirmed' | 'waitlist' | 'cancelled' | 'did_not_show'
      team_name: 'dark' | 'light'
      assignment_source: 'ai' | 'manual'
      rule_type: 'avoid_pair' | 'force_pair' | 'min_defenders' | 'min_goalkeepers' | 'balance_rating'
    }
  }
}

// Convenience type exports
export type User = Database['public']['Tables']['users']['Row']
export type PlayerProfile = Database['public']['Tables']['player_profiles']['Row']
export type Group = Database['public']['Tables']['groups']['Row']
export type GroupMembership = Database['public']['Tables']['group_memberships']['Row']
export type Match = Database['public']['Tables']['matches']['Row']
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
