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
          notification_prefs: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          name: string
          avatar_url?: string | null
          preferred_language?: 'es' | 'en'
          notification_prefs?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          name?: string
          avatar_url?: string | null
          preferred_language?: 'es' | 'en'
          notification_prefs?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
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
          matches_played?: number
          goals?: number
          assists?: number
          mvp_count?: number
          clean_sheets?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
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
        Relationships: []
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
        Relationships: []
      }
      matches: {
        Row: {
          id: string
          group_id: string
          date_time: string
          location: string | null
          status: 'draft' | 'signup_open' | 'signup_closed' | 'full' | 'teams_created' | 'finished' | 'cancelled'
          max_players: number
          recurring_pattern_id: string | null
          ai_input_snapshot: Json | null
          notes: string | null
          results_finalized: boolean
          mvp_player_id: string | null
          duration_minutes: number
          results_request_delay_minutes: number
          finished_at: string | null
          result_status: 'pending' | 'provisional' | 'consensus' | 'locked'
          result_locked_by: string | null
          result_locked_at: string | null
          result_posted_key: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          group_id: string
          date_time: string
          location?: string | null
          status?: 'draft' | 'signup_open' | 'signup_closed' | 'full' | 'teams_created' | 'finished' | 'cancelled'
          max_players?: number
          recurring_pattern_id?: string | null
          ai_input_snapshot?: Json | null
          notes?: string | null
          results_finalized?: boolean
          mvp_player_id?: string | null
          duration_minutes?: number
          results_request_delay_minutes?: number
          finished_at?: string | null
          result_status?: 'pending' | 'provisional' | 'consensus' | 'locked'
          result_locked_by?: string | null
          result_locked_at?: string | null
          result_posted_key?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          date_time?: string
          location?: string | null
          status?: 'draft' | 'signup_open' | 'signup_closed' | 'full' | 'teams_created' | 'finished' | 'cancelled'
          max_players?: number
          recurring_pattern_id?: string | null
          ai_input_snapshot?: Json | null
          notes?: string | null
          results_finalized?: boolean
          mvp_player_id?: string | null
          duration_minutes?: number
          results_request_delay_minutes?: number
          finished_at?: string | null
          result_status?: 'pending' | 'provisional' | 'consensus' | 'locked'
          result_locked_by?: string | null
          result_locked_at?: string | null
          result_posted_key?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      recurring_patterns: {
        Row: {
          id: string
          group_id: string
          weekday: number
          match_time: string
          location: string | null
          max_players: number
          signup_opens_weekday: number
          signup_opens_time: string
          timezone: string
          is_active: boolean
          created_by_user_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          group_id: string
          weekday: number
          match_time: string
          location?: string | null
          max_players?: number
          signup_opens_weekday: number
          signup_opens_time: string
          timezone?: string
          is_active?: boolean
          created_by_user_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          weekday?: number
          match_time?: string
          location?: string | null
          max_players?: number
          signup_opens_weekday?: number
          signup_opens_time?: string
          timezone?: string
          is_active?: boolean
          created_by_user_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
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
          self_signup_token: string | null
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
          self_signup_token?: string | null
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
          self_signup_token?: string | null
          created_at?: string
        }
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
      }
      peer_ratings: {
        Row: {
          id: string
          group_id: string
          voter_player_id: string
          rated_player_id: string
          skipped: boolean
          goalkeeping: number | null
          defense: number | null
          attack: number | null
          physical: number | null
          tags: string[]
          is_baseline: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          group_id: string
          voter_player_id: string
          rated_player_id: string
          skipped?: boolean
          goalkeeping?: number | null
          defense?: number | null
          attack?: number | null
          physical?: number | null
          tags?: string[]
          is_baseline?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          voter_player_id?: string
          rated_player_id?: string
          skipped?: boolean
          goalkeeping?: number | null
          defense?: number | null
          attack?: number | null
          physical?: number | null
          tags?: string[]
          is_baseline?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      player_rating_summary: {
        Row: {
          player_id: string
          goalkeeping: number | null
          defense: number | null
          attack: number | null
          physical: number | null
          overall: number
          tags: string[]
          peer_votes: number
          matches_rated: number
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
          default_duration_minutes: number
          default_results_request_delay_minutes: number
          results_reminder_hours: number
          results_window_days: number
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
          default_duration_minutes?: number
          default_results_request_delay_minutes?: number
          results_reminder_hours?: number
          results_window_days?: number
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
          default_duration_minutes?: number
          default_results_request_delay_minutes?: number
          results_reminder_hours?: number
          results_window_days?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
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
        Relationships: []
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
          source: 'admin' | 'consensus'
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
          source?: 'admin' | 'consensus'
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
          source?: 'admin' | 'consensus'
          created_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          group_id: string
          match_id: string | null
          recipient_player_id: string | null
          type: string
          payload: Json
          created_at: string
        }
        Insert: {
          id?: string
          group_id: string
          match_id?: string | null
          recipient_player_id?: string | null
          type: string
          payload?: Json
          created_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          match_id?: string | null
          recipient_player_id?: string | null
          type?: string
          payload?: Json
          created_at?: string
        }
        Relationships: []
      }
      notification_reads: {
        Row: {
          notification_id: string
          player_id: string
          read_at: string
        }
        Insert: {
          notification_id: string
          player_id: string
          read_at?: string
        }
        Update: {
          notification_id?: string
          player_id?: string
          read_at?: string
        }
        Relationships: []
      }
      notification_outbox: {
        Row: {
          id: string
          group_id: string
          match_id: string | null
          type: string
          payload: Json
          channel: string
          status: string
          attempts: number
          last_error: string | null
          created_at: string
          sent_at: string | null
        }
        Insert: {
          id?: string
          group_id: string
          match_id?: string | null
          type: string
          payload?: Json
          channel?: string
          status?: string
          attempts?: number
          last_error?: string | null
          created_at?: string
          sent_at?: string | null
        }
        Update: {
          id?: string
          group_id?: string
          match_id?: string | null
          type?: string
          payload?: Json
          channel?: string
          status?: string
          attempts?: number
          last_error?: string | null
          created_at?: string
          sent_at?: string | null
        }
        Relationships: []
      }
      scheduled_jobs: {
        Row: {
          id: string
          group_id: string
          match_id: string | null
          job_type: 'auto_finish' | 'results_request' | 'results_reminder' | 'results_window_close'
          run_at: string
          payload: Json
          status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
          attempts: number
          last_error: string | null
          locked_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          group_id: string
          match_id?: string | null
          job_type: 'auto_finish' | 'results_request' | 'results_reminder' | 'results_window_close'
          run_at: string
          payload?: Json
          status?: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
          attempts?: number
          last_error?: string | null
          locked_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          match_id?: string | null
          job_type?: 'auto_finish' | 'results_request' | 'results_reminder' | 'results_window_close'
          run_at?: string
          payload?: Json
          status?: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
          attempts?: number
          last_error?: string | null
          locked_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      match_reports: {
        Row: {
          id: string
          match_id: string
          reporter_player_id: string
          dark_score: number | null
          light_score: number | null
          dark_goals_complete: boolean
          light_goals_complete: boolean
          mvp_candidate_id: string | null
          submitted_after_lock: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          match_id: string
          reporter_player_id: string
          dark_score?: number | null
          light_score?: number | null
          dark_goals_complete?: boolean
          light_goals_complete?: boolean
          mvp_candidate_id?: string | null
          submitted_after_lock?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          match_id?: string
          reporter_player_id?: string
          dark_score?: number | null
          light_score?: number | null
          dark_goals_complete?: boolean
          light_goals_complete?: boolean
          mvp_candidate_id?: string | null
          submitted_after_lock?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      match_report_stats: {
        Row: {
          id: string
          report_id: string
          team_id: string
          player_id: string | null
          guest_player_id: string | null
          goals: number
          assists: number
        }
        Insert: {
          id?: string
          report_id: string
          team_id: string
          player_id?: string | null
          guest_player_id?: string | null
          goals?: number
          assists?: number
        }
        Update: {
          id?: string
          report_id?: string
          team_id?: string
          player_id?: string | null
          guest_player_id?: string | null
          goals?: number
          assists?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      signup_for_match: {
        Args: {
          p_match_id: string
          p_notes?: string
          p_position_preference?: string
        }
        Returns: Database['public']['Tables']['match_signups']['Row']
      }
      cancel_my_signup: {
        Args: {
          p_match_id: string
        }
        Returns: undefined
      }
      admin_add_guest_signup: {
        Args: {
          p_match_id: string
          p_display_name: string
          p_notes?: string
          p_estimated_rating?: number
          p_preferred_positions?: string[]
        }
        Returns: Database['public']['Tables']['match_signups']['Row']
      }
      admin_remove_signup: {
        Args: {
          p_signup_id: string
        }
        Returns: undefined
      }
      admin_set_signup_status: {
        Args: {
          p_signup_id: string
          p_status: Database['public']['Enums']['signup_status']
        }
        Returns: undefined
      }
      admin_set_match_status: {
        Args: {
          p_match_id: string
          p_status: Database['public']['Enums']['match_status']
        }
        Returns: Database['public']['Tables']['matches']['Row']
      }
      get_public_match: {
        Args: {
          p_match_id: string
        }
        Returns: Json
      }
      public_guest_signup: {
        Args: {
          p_match_id: string
          p_display_name: string
          p_token: string
        }
        Returns: Json
      }
      cancel_guest_signup: {
        Args: {
          p_match_id: string
          p_token: string
        }
        Returns: undefined
      }
      promote_from_waitlist: {
        Args: {
          p_match_id: string
        }
        Returns: string | null
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
      get_public_group_by_invite: {
        Args: {
          p_invite_code: string
        }
        Returns: Json
      }
      admin_finalize_match_results: {
        Args: {
          p_match_id: string
        }
        Returns: undefined
      }
      recompute_match_mvp: {
        Args: {
          p_match_id: string
        }
        Returns: undefined
      }
      award_badges_for_match: {
        Args: {
          p_match_id: string
        }
        Returns: undefined
      }
      save_team_assignments: {
        Args: {
          p_match_id: string
          p_assignments: Json
        }
        Returns: undefined
      }
      generate_recurring_matches: {
        Args: {
          p_group_id?: string
        }
        Returns: number
      }
      get_recent_match_history: {
        Args: {
          p_group_id: string
          p_limit?: number
        }
        Returns: {
          match_id: string
          match_date: string
          dark_team_players: Json | null
          light_team_players: Json | null
        }[]
      }
      emit_notification: {
        Args: {
          p_group_id: string
          p_match_id: string | null
          p_type: string
          p_payload: Json
        }
        Returns: undefined
      }
      mark_notifications_read: {
        Args: {
          p_ids: string[]
        }
        Returns: undefined
      }
      get_unread_notification_count: {
        Args: Record<string, never>
        Returns: number
      }
      claim_due_jobs: {
        Args: {
          p_limit?: number
        }
        Returns: Database['public']['Tables']['scheduled_jobs']['Row'][]
      }
      run_scheduled_job: {
        Args: {
          p_job_id: string
        }
        Returns: Json
      }
      schedule_match_jobs: {
        Args: {
          p_match_id: string
        }
        Returns: undefined
      }
      auto_finish_match: {
        Args: {
          p_match_id: string
        }
        Returns: boolean
      }
      recompute_player_stats: {
        Args: {
          p_player_id: string
        }
        Returns: undefined
      }
      match_report_window_open: {
        Args: {
          p_match_id: string
        }
        Returns: boolean
      }
      result_weight: {
        Args: {
          p_group_id: string
          p_player_id: string
        }
        Returns: number
      }
      recompute_match_consensus: {
        Args: {
          p_match_id: string
        }
        Returns: undefined
      }
      build_results_posted_payload: {
        Args: {
          p_match_id: string
        }
        Returns: Json
      }
      submit_match_report: {
        Args: {
          p_match_id: string
          p_dark_score: number | null
          p_light_score: number | null
          p_dark_goals_complete: boolean
          p_light_goals_complete: boolean
          p_mvp_candidate_id: string | null
          p_stats: Json
        }
        Returns: string
      }
      delete_my_match_report: {
        Args: {
          p_match_id: string
        }
        Returns: undefined
      }
      admin_set_match_result: {
        Args: {
          p_match_id: string
          p_dark_score: number
          p_light_score: number
          p_events: Json
          p_mvp_player_id: string | null
        }
        Returns: undefined
      }
      admin_unlock_match_result: {
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
      match_status: 'draft' | 'signup_open' | 'signup_closed' | 'full' | 'teams_created' | 'finished' | 'cancelled'
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
export type MatchReport = Database['public']['Tables']['match_reports']['Row']
export type MatchReportStat = Database['public']['Tables']['match_report_stats']['Row']
export type MatchResultStatus = Database['public']['Tables']['matches']['Row']['result_status']

// Shapes of the jsonb arguments of the report/result RPCs (00019).
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
