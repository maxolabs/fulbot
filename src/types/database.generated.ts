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
      group_memberships: {
        Row: {
          group_id: string
          id: string
          is_active: boolean | null
          joined_at: string | null
          member_breakdown: Json | null
          member_score: number | null
          member_score_at: string | null
          player_id: string
          role: Database["public"]["Enums"]["group_role"] | null
          signup_cooldown: boolean
        }
        Insert: {
          group_id: string
          id?: string
          is_active?: boolean | null
          joined_at?: string | null
          member_breakdown?: Json | null
          member_score?: number | null
          member_score_at?: string | null
          player_id: string
          role?: Database["public"]["Enums"]["group_role"] | null
          signup_cooldown?: boolean
        }
        Update: {
          group_id?: string
          id?: string
          is_active?: boolean | null
          joined_at?: string | null
          member_breakdown?: Json | null
          member_score?: number | null
          member_score_at?: string | null
          player_id?: string
          role?: Database["public"]["Enums"]["group_role"] | null
          signup_cooldown?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "group_memberships_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_memberships_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string | null
          created_by_user_id: string | null
          default_match_day: number | null
          default_match_time: string | null
          default_max_players: number | null
          description: string | null
          id: string
          invite_code: string | null
          name: string
          settings: Json | null
          slug: string
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by_user_id?: string | null
          default_match_day?: number | null
          default_match_time?: string | null
          default_max_players?: number | null
          description?: string | null
          id?: string
          invite_code?: string | null
          name: string
          settings?: Json | null
          slug: string
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by_user_id?: string | null
          default_match_day?: number | null
          default_match_time?: string | null
          default_max_players?: number | null
          description?: string | null
          id?: string
          invite_code?: string | null
          name?: string
          settings?: Json | null
          slug?: string
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "groups_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_players: {
        Row: {
          created_at: string | null
          created_by_user_id: string | null
          display_name: string
          estimated_rating: number | null
          group_id: string | null
          id: string
          notes: string | null
          preferred_positions: string[] | null
          self_signup_token: string | null
        }
        Insert: {
          created_at?: string | null
          created_by_user_id?: string | null
          display_name: string
          estimated_rating?: number | null
          group_id?: string | null
          id?: string
          notes?: string | null
          preferred_positions?: string[] | null
          self_signup_token?: string | null
        }
        Update: {
          created_at?: string | null
          created_by_user_id?: string | null
          display_name?: string
          estimated_rating?: number | null
          group_id?: string | null
          id?: string
          notes?: string | null
          preferred_positions?: string[] | null
          self_signup_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guest_players_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_players_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      match_events: {
        Row: {
          created_at: string
          event_type: string
          guest_player_id: string | null
          id: string
          linked_event_id: string | null
          match_id: string
          minute: number | null
          player_id: string | null
          source: string
          team_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          guest_player_id?: string | null
          id?: string
          linked_event_id?: string | null
          match_id: string
          minute?: number | null
          player_id?: string | null
          source?: string
          team_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          guest_player_id?: string | null
          id?: string
          linked_event_id?: string | null
          match_id?: string
          minute?: number | null
          player_id?: string | null
          source?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_events_guest_player_id_fkey"
            columns: ["guest_player_id"]
            isOneToOne: false
            referencedRelation: "guest_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_events_linked_event_id_fkey"
            columns: ["linked_event_id"]
            isOneToOne: false
            referencedRelation: "match_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_events_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      match_mvp_votes: {
        Row: {
          candidate_player_id: string
          created_at: string | null
          id: string
          match_id: string
          voter_player_id: string
        }
        Insert: {
          candidate_player_id: string
          created_at?: string | null
          id?: string
          match_id: string
          voter_player_id: string
        }
        Update: {
          candidate_player_id?: string
          created_at?: string | null
          id?: string
          match_id?: string
          voter_player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_mvp_votes_candidate_player_id_fkey"
            columns: ["candidate_player_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_mvp_votes_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_mvp_votes_voter_player_id_fkey"
            columns: ["voter_player_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_ratings: {
        Row: {
          comment: string | null
          created_at: string | null
          id: string
          match_id: string
          rated_player_id: string
          rating: number
          voter_player_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          id?: string
          match_id: string
          rated_player_id: string
          rating: number
          voter_player_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          id?: string
          match_id?: string
          rated_player_id?: string
          rating?: number
          voter_player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_ratings_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_ratings_rated_player_id_fkey"
            columns: ["rated_player_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_ratings_voter_player_id_fkey"
            columns: ["voter_player_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_report_stats: {
        Row: {
          assists: number
          goals: number
          guest_player_id: string | null
          id: string
          player_id: string | null
          report_id: string
          team_id: string
        }
        Insert: {
          assists?: number
          goals?: number
          guest_player_id?: string | null
          id?: string
          player_id?: string | null
          report_id: string
          team_id: string
        }
        Update: {
          assists?: number
          goals?: number
          guest_player_id?: string | null
          id?: string
          player_id?: string | null
          report_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_report_stats_guest_player_id_fkey"
            columns: ["guest_player_id"]
            isOneToOne: false
            referencedRelation: "guest_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_report_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_report_stats_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "match_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_report_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      match_reports: {
        Row: {
          created_at: string
          dark_goals_complete: boolean
          dark_score: number | null
          id: string
          light_goals_complete: boolean
          light_score: number | null
          match_id: string
          mvp_candidate_id: string | null
          reporter_player_id: string
          submitted_after_lock: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          dark_goals_complete?: boolean
          dark_score?: number | null
          id?: string
          light_goals_complete?: boolean
          light_score?: number | null
          match_id: string
          mvp_candidate_id?: string | null
          reporter_player_id: string
          submitted_after_lock?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          dark_goals_complete?: boolean
          dark_score?: number | null
          id?: string
          light_goals_complete?: boolean
          light_score?: number | null
          match_id?: string
          mvp_candidate_id?: string | null
          reporter_player_id?: string
          submitted_after_lock?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_reports_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_reports_mvp_candidate_id_fkey"
            columns: ["mvp_candidate_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_reports_reporter_player_id_fkey"
            columns: ["reporter_player_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_signups: {
        Row: {
          cancel_time: string | null
          guest_player_id: string | null
          id: string
          match_id: string
          notes: string | null
          player_id: string | null
          position_preference: string | null
          signup_time: string | null
          status: Database["public"]["Enums"]["signup_status"] | null
          waitlist_position: number | null
          waitlist_reason: string | null
        }
        Insert: {
          cancel_time?: string | null
          guest_player_id?: string | null
          id?: string
          match_id: string
          notes?: string | null
          player_id?: string | null
          position_preference?: string | null
          signup_time?: string | null
          status?: Database["public"]["Enums"]["signup_status"] | null
          waitlist_position?: number | null
          waitlist_reason?: string | null
        }
        Update: {
          cancel_time?: string | null
          guest_player_id?: string | null
          id?: string
          match_id?: string
          notes?: string | null
          player_id?: string | null
          position_preference?: string | null
          signup_time?: string | null
          status?: Database["public"]["Enums"]["signup_status"] | null
          waitlist_position?: number | null
          waitlist_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_signups_guest_player_id_fkey"
            columns: ["guest_player_id"]
            isOneToOne: false
            referencedRelation: "guest_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_signups_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_signups_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          ai_input_snapshot: Json | null
          created_at: string | null
          date_time: string
          duration_minutes: number
          finished_at: string | null
          group_id: string
          id: string
          lineup_needs_review: boolean
          location: string | null
          max_players: number | null
          mvp_player_id: string | null
          notes: string | null
          recurring_pattern_id: string | null
          result_locked_at: string | null
          result_locked_by: string | null
          result_posted_key: string | null
          result_status: string
          results_finalized: boolean
          results_request_delay_minutes: number
          signup_opened_at: string | null
          status: Database["public"]["Enums"]["match_status"] | null
          updated_at: string | null
        }
        Insert: {
          ai_input_snapshot?: Json | null
          created_at?: string | null
          date_time: string
          duration_minutes?: number
          finished_at?: string | null
          group_id: string
          id?: string
          lineup_needs_review?: boolean
          location?: string | null
          max_players?: number | null
          mvp_player_id?: string | null
          notes?: string | null
          recurring_pattern_id?: string | null
          result_locked_at?: string | null
          result_locked_by?: string | null
          result_posted_key?: string | null
          result_status?: string
          results_finalized?: boolean
          results_request_delay_minutes?: number
          signup_opened_at?: string | null
          status?: Database["public"]["Enums"]["match_status"] | null
          updated_at?: string | null
        }
        Update: {
          ai_input_snapshot?: Json | null
          created_at?: string | null
          date_time?: string
          duration_minutes?: number
          finished_at?: string | null
          group_id?: string
          id?: string
          lineup_needs_review?: boolean
          location?: string | null
          max_players?: number | null
          mvp_player_id?: string | null
          notes?: string | null
          recurring_pattern_id?: string | null
          result_locked_at?: string | null
          result_locked_by?: string | null
          result_posted_key?: string | null
          result_status?: string
          results_finalized?: boolean
          results_request_delay_minutes?: number
          signup_opened_at?: string | null
          status?: Database["public"]["Enums"]["match_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_mvp_player_id_fkey"
            columns: ["mvp_player_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_recurring_pattern_id_fkey"
            columns: ["recurring_pattern_id"]
            isOneToOne: false
            referencedRelation: "recurring_patterns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_result_locked_by_fkey"
            columns: ["result_locked_by"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      member_events: {
        Row: {
          created_at: string
          group_id: string
          id: string
          match_id: string | null
          note: string | null
          player_id: string
          points: number
          reported_by: string | null
          source: Database["public"]["Enums"]["member_event_source"]
          subject_id: string | null
          type: Database["public"]["Enums"]["member_event_type"]
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          match_id?: string | null
          note?: string | null
          player_id: string
          points: number
          reported_by?: string | null
          source: Database["public"]["Enums"]["member_event_source"]
          subject_id?: string | null
          type: Database["public"]["Enums"]["member_event_type"]
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          match_id?: string | null
          note?: string | null
          player_id?: string
          points?: number
          reported_by?: string | null
          source?: Database["public"]["Enums"]["member_event_source"]
          subject_id?: string | null
          type?: Database["public"]["Enums"]["member_event_type"]
        }
        Relationships: [
          {
            foreignKeyName: "member_events_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_events_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_events_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_events_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          attempts: number
          available_at: string
          channel: string
          claimed_at: string | null
          created_at: string | null
          group_id: string
          id: string
          last_error: string | null
          lease_id: string | null
          match_id: string | null
          payload: Json
          sent_at: string | null
          status: string
          type: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          channel?: string
          claimed_at?: string | null
          created_at?: string | null
          group_id: string
          id?: string
          last_error?: string | null
          lease_id?: string | null
          match_id?: string | null
          payload?: Json
          sent_at?: string | null
          status?: string
          type: string
        }
        Update: {
          attempts?: number
          available_at?: string
          channel?: string
          claimed_at?: string | null
          created_at?: string | null
          group_id?: string
          id?: string
          last_error?: string | null
          lease_id?: string | null
          match_id?: string | null
          payload?: Json
          sent_at?: string | null
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_outbox_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "notification_reads_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_reads_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          created_at: string | null
          default_duration_minutes: number
          default_results_request_delay_minutes: number
          group_id: string
          id: string
          notify_on_teams_created: boolean | null
          notify_on_waitlist_promotion: boolean | null
          reminder_hours_before: number | null
          results_reminder_hours: number
          results_window_days: number
          send_signup_link_on_create: boolean | null
          updated_at: string | null
          whatsapp_webhook_url: string | null
        }
        Insert: {
          created_at?: string | null
          default_duration_minutes?: number
          default_results_request_delay_minutes?: number
          group_id: string
          id?: string
          notify_on_teams_created?: boolean | null
          notify_on_waitlist_promotion?: boolean | null
          reminder_hours_before?: number | null
          results_reminder_hours?: number
          results_window_days?: number
          send_signup_link_on_create?: boolean | null
          updated_at?: string | null
          whatsapp_webhook_url?: string | null
        }
        Update: {
          created_at?: string | null
          default_duration_minutes?: number
          default_results_request_delay_minutes?: number
          group_id?: string
          id?: string
          notify_on_teams_created?: boolean | null
          notify_on_waitlist_promotion?: boolean | null
          reminder_hours_before?: number | null
          results_reminder_hours?: number
          results_window_days?: number
          send_signup_link_on_create?: boolean | null
          updated_at?: string | null
          whatsapp_webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_settings_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          group_id: string
          id: string
          match_id: string | null
          payload: Json
          recipient_player_id: string | null
          type: string
        }
        Insert: {
          created_at?: string | null
          group_id: string
          id?: string
          match_id?: string | null
          payload?: Json
          recipient_player_id?: string | null
          type: string
        }
        Update: {
          created_at?: string | null
          group_id?: string
          id?: string
          match_id?: string | null
          payload?: Json
          recipient_player_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_player_id_fkey"
            columns: ["recipient_player_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      peer_ratings: {
        Row: {
          attack: number | null
          created_at: string
          defense: number | null
          goalkeeping: number | null
          group_id: string
          id: string
          is_baseline: boolean
          physical: number | null
          rated_player_id: string
          skipped: boolean
          tags: string[]
          updated_at: string
          voter_player_id: string
        }
        Insert: {
          attack?: number | null
          created_at?: string
          defense?: number | null
          goalkeeping?: number | null
          group_id: string
          id?: string
          is_baseline?: boolean
          physical?: number | null
          rated_player_id: string
          skipped?: boolean
          tags?: string[]
          updated_at?: string
          voter_player_id: string
        }
        Update: {
          attack?: number | null
          created_at?: string
          defense?: number | null
          goalkeeping?: number | null
          group_id?: string
          id?: string
          is_baseline?: boolean
          physical?: number | null
          rated_player_id?: string
          skipped?: boolean
          tags?: string[]
          updated_at?: string
          voter_player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "peer_ratings_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "peer_ratings_rated_player_id_fkey"
            columns: ["rated_player_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "peer_ratings_voter_player_id_fkey"
            columns: ["voter_player_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      player_badges: {
        Row: {
          badge_type: string
          earned_at: string | null
          id: string
          match_id: string | null
          metadata: Json | null
          player_id: string
        }
        Insert: {
          badge_type: string
          earned_at?: string | null
          id?: string
          match_id?: string | null
          metadata?: Json | null
          player_id: string
        }
        Update: {
          badge_type?: string
          earned_at?: string | null
          id?: string
          match_id?: string | null
          metadata?: Json | null
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_badges_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_badges_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      player_profiles: {
        Row: {
          assists: number | null
          clean_sheets: number | null
          created_at: string | null
          display_name: string
          fitness_status: Database["public"]["Enums"]["fitness_status"] | null
          footedness: Database["public"]["Enums"]["footedness"] | null
          goalkeeper_willingness: number | null
          goals: number | null
          id: string
          main_position: string | null
          matches_played: number | null
          mvp_count: number | null
          nickname: string | null
          preferred_positions: string[] | null
          profile_completed_at: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          assists?: number | null
          clean_sheets?: number | null
          created_at?: string | null
          display_name: string
          fitness_status?: Database["public"]["Enums"]["fitness_status"] | null
          footedness?: Database["public"]["Enums"]["footedness"] | null
          goalkeeper_willingness?: number | null
          goals?: number | null
          id?: string
          main_position?: string | null
          matches_played?: number | null
          mvp_count?: number | null
          nickname?: string | null
          preferred_positions?: string[] | null
          profile_completed_at?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          assists?: number | null
          clean_sheets?: number | null
          created_at?: string | null
          display_name?: string
          fitness_status?: Database["public"]["Enums"]["fitness_status"] | null
          footedness?: Database["public"]["Enums"]["footedness"] | null
          goalkeeper_willingness?: number | null
          goals?: number | null
          id?: string
          main_position?: string | null
          matches_played?: number | null
          mvp_count?: number | null
          nickname?: string | null
          preferred_positions?: string[] | null
          profile_completed_at?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      player_rating_summary: {
        Row: {
          attack: number | null
          defense: number | null
          goalkeeping: number | null
          matches_rated: number
          overall: number
          peer_votes: number
          physical: number | null
          player_id: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          attack?: number | null
          defense?: number | null
          goalkeeping?: number | null
          matches_rated?: number
          overall?: number
          peer_votes?: number
          physical?: number | null
          player_id: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          attack?: number | null
          defense?: number | null
          goalkeeping?: number | null
          matches_rated?: number
          overall?: number
          peer_votes?: number
          physical?: number | null
          player_id?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_rating_summary_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_deliveries: {
        Row: {
          attempts: number
          available_at: string
          created_at: string
          id: string
          last_error: string | null
          lease_id: string | null
          notification_id: string
          status: string
          subscription_id: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          created_at?: string
          id?: string
          last_error?: string | null
          lease_id?: string | null
          notification_id: string
          status?: string
          subscription_id: string
        }
        Update: {
          attempts?: number
          available_at?: string
          created_at?: string
          id?: string
          last_error?: string | null
          lease_id?: string | null
          notification_id?: string
          status?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_deliveries_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "push_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_match_occurrences: {
        Row: {
          created_at: string
          match_id: string | null
          occurrence_date: string
          pattern_id: string
        }
        Insert: {
          created_at?: string
          match_id?: string | null
          occurrence_date: string
          pattern_id: string
        }
        Update: {
          created_at?: string
          match_id?: string | null
          occurrence_date?: string
          pattern_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_match_occurrences_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_match_occurrences_pattern_id_fkey"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "recurring_patterns"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_patterns: {
        Row: {
          created_at: string | null
          created_by_user_id: string | null
          group_id: string
          id: string
          is_active: boolean
          location: string | null
          match_time: string
          max_players: number
          signup_opens_time: string
          signup_opens_weekday: number
          timezone: string
          updated_at: string | null
          weekday: number
        }
        Insert: {
          created_at?: string | null
          created_by_user_id?: string | null
          group_id: string
          id?: string
          is_active?: boolean
          location?: string | null
          match_time: string
          max_players?: number
          signup_opens_time: string
          signup_opens_weekday: number
          timezone?: string
          updated_at?: string | null
          weekday: number
        }
        Update: {
          created_at?: string | null
          created_by_user_id?: string | null
          group_id?: string
          id?: string
          is_active?: boolean
          location?: string | null
          match_time?: string
          max_players?: number
          signup_opens_time?: string
          signup_opens_weekday?: number
          timezone?: string
          updated_at?: string | null
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "recurring_patterns_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_patterns_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      rule_sets: {
        Row: {
          created_at: string | null
          created_by_user_id: string | null
          data: Json
          group_id: string | null
          id: string
          is_active: boolean | null
          match_id: string | null
          rule_type: Database["public"]["Enums"]["rule_type"]
        }
        Insert: {
          created_at?: string | null
          created_by_user_id?: string | null
          data?: Json
          group_id?: string | null
          id?: string
          is_active?: boolean | null
          match_id?: string | null
          rule_type: Database["public"]["Enums"]["rule_type"]
        }
        Update: {
          created_at?: string | null
          created_by_user_id?: string | null
          data?: Json
          group_id?: string | null
          id?: string
          is_active?: boolean | null
          match_id?: string | null
          rule_type?: Database["public"]["Enums"]["rule_type"]
        }
        Relationships: [
          {
            foreignKeyName: "rule_sets_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_sets_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_sets_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_jobs: {
        Row: {
          attempts: number
          created_at: string
          group_id: string
          id: string
          job_type: string
          last_error: string | null
          locked_at: string | null
          match_id: string | null
          payload: Json
          run_at: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          group_id: string
          id?: string
          job_type: string
          last_error?: string | null
          locked_at?: string | null
          match_id?: string | null
          payload?: Json
          run_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          group_id?: string
          id?: string
          job_type?: string
          last_error?: string | null
          locked_at?: string | null
          match_id?: string | null
          payload?: Json
          run_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_jobs_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_jobs_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduler_state: {
        Row: {
          id: number
          last_tick_at: string | null
        }
        Insert: {
          id?: number
          last_tick_at?: string | null
        }
        Update: {
          id?: number
          last_tick_at?: string | null
        }
        Relationships: []
      }
      team_assignments: {
        Row: {
          created_at: string | null
          guest_player_id: string | null
          id: string
          order_index: number | null
          player_id: string | null
          position: string
          source: Database["public"]["Enums"]["assignment_source"] | null
          team_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          guest_player_id?: string | null
          id?: string
          order_index?: number | null
          player_id?: string | null
          position: string
          source?: Database["public"]["Enums"]["assignment_source"] | null
          team_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          guest_player_id?: string | null
          id?: string
          order_index?: number | null
          player_id?: string | null
          position?: string
          source?: Database["public"]["Enums"]["assignment_source"] | null
          team_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_assignments_guest_player_id_fkey"
            columns: ["guest_player_id"]
            isOneToOne: false
            referencedRelation: "guest_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_assignments_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_assignments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          color_hex: string | null
          created_at: string | null
          created_by_user_id: string | null
          id: string
          match_id: string
          name: Database["public"]["Enums"]["team_name"]
          score: number
          updated_at: string | null
        }
        Insert: {
          color_hex?: string | null
          created_at?: string | null
          created_by_user_id?: string | null
          id?: string
          match_id: string
          name: Database["public"]["Enums"]["team_name"]
          score?: number
          updated_at?: string | null
        }
        Update: {
          color_hex?: string | null
          created_at?: string | null
          created_by_user_id?: string | null
          id?: string
          match_id?: string
          name?: Database["public"]["Enums"]["team_name"]
          score?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string
          id: string
          name: string
          notification_prefs: Json
          preferred_language:
            | Database["public"]["Enums"]["user_language"]
            | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email: string
          id: string
          name: string
          notification_prefs?: Json
          preferred_language?:
            | Database["public"]["Enums"]["user_language"]
            | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          id?: string
          name?: string
          notification_prefs?: Json
          preferred_language?:
            | Database["public"]["Enums"]["user_language"]
            | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_add_guest_signup: {
        Args: {
          p_display_name: string
          p_estimated_rating?: number
          p_match_id: string
          p_notes?: string
          p_preferred_positions?: string[]
        }
        Returns: {
          cancel_time: string | null
          guest_player_id: string | null
          id: string
          match_id: string
          notes: string | null
          player_id: string | null
          position_preference: string | null
          signup_time: string | null
          status: Database["public"]["Enums"]["signup_status"] | null
          waitlist_position: number | null
          waitlist_reason: string | null
        }
        SetofOptions: {
          from: "*"
          to: "match_signups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_adjust_member_score: {
        Args: {
          p_group_id: string
          p_note: string
          p_player_id: string
          p_points: number
        }
        Returns: string
      }
      admin_delete_member_event: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      admin_finalize_match_results: {
        Args: { p_match_id: string }
        Returns: undefined
      }
      admin_recompute_member_scores: {
        Args: { p_group_id: string }
        Returns: undefined
      }
      admin_remove_member: {
        Args: { p_membership_id: string }
        Returns: undefined
      }
      admin_remove_signup: { Args: { p_signup_id: string }; Returns: undefined }
      admin_set_guest_rating: {
        Args: { p_guest_player_id: string; p_rating: number }
        Returns: undefined
      }
      admin_set_match_max_players: {
        Args: { p_match_id: string; p_max_players: number }
        Returns: {
          ai_input_snapshot: Json | null
          created_at: string | null
          date_time: string
          duration_minutes: number
          finished_at: string | null
          group_id: string
          id: string
          lineup_needs_review: boolean
          location: string | null
          max_players: number | null
          mvp_player_id: string | null
          notes: string | null
          recurring_pattern_id: string | null
          result_locked_at: string | null
          result_locked_by: string | null
          result_posted_key: string | null
          result_status: string
          results_finalized: boolean
          results_request_delay_minutes: number
          signup_opened_at: string | null
          status: Database["public"]["Enums"]["match_status"] | null
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "matches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_match_result: {
        Args: {
          p_dark_score: number
          p_events: Json
          p_light_score: number
          p_match_id: string
          p_mvp_player_id: string
        }
        Returns: undefined
      }
      admin_set_match_status: {
        Args: {
          p_match_id: string
          p_status: Database["public"]["Enums"]["match_status"]
        }
        Returns: {
          ai_input_snapshot: Json | null
          created_at: string | null
          date_time: string
          duration_minutes: number
          finished_at: string | null
          group_id: string
          id: string
          lineup_needs_review: boolean
          location: string | null
          max_players: number | null
          mvp_player_id: string | null
          notes: string | null
          recurring_pattern_id: string | null
          result_locked_at: string | null
          result_locked_by: string | null
          result_posted_key: string | null
          result_status: string
          results_finalized: boolean
          results_request_delay_minutes: number
          signup_opened_at: string | null
          status: Database["public"]["Enums"]["match_status"] | null
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "matches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_signup_status: {
        Args: {
          p_signup_id: string
          p_status: Database["public"]["Enums"]["signup_status"]
        }
        Returns: undefined
      }
      admin_unlock_match_result: {
        Args: { p_match_id: string }
        Returns: undefined
      }
      auto_finish_match: { Args: { p_match_id: string }; Returns: boolean }
      award_badges_for_match: {
        Args: { p_match_id: string }
        Returns: undefined
      }
      build_results_posted_payload: {
        Args: { p_match_id: string }
        Returns: Json
      }
      can_report_member_conduct: {
        Args: { p_group_id: string }
        Returns: boolean
      }
      cancel_guest_signup: {
        Args: { p_match_id: string; p_token: string }
        Returns: undefined
      }
      cancel_my_signup: { Args: { p_match_id: string }; Returns: undefined }
      claim_due_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          created_at: string
          group_id: string
          id: string
          job_type: string
          last_error: string | null
          locked_at: string | null
          match_id: string | null
          payload: Json
          run_at: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "scheduled_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_notification_outbox: { Args: { p_limit?: number }; Returns: Json[] }
      claim_push_deliveries: { Args: { p_limit?: number }; Returns: Json[] }
      create_group_with_admin: {
        Args: {
          p_default_match_day?: number
          p_default_match_time?: string
          p_default_max_players?: number
          p_description?: string
          p_name: string
          p_slug: string
          p_timezone?: string
        }
        Returns: {
          created_at: string | null
          created_by_user_id: string | null
          default_match_day: number | null
          default_match_time: string | null
          default_max_players: number | null
          description: string | null
          id: string
          invite_code: string | null
          name: string
          settings: Json | null
          slug: string
          timezone: string | null
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "groups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_my_match_report: {
        Args: { p_match_id: string }
        Returns: undefined
      }
      emit_attendance_events: {
        Args: { p_match_id: string }
        Returns: undefined
      }
      emit_cancel_event: {
        Args: { p_match_id: string; p_player_id: string }
        Returns: undefined
      }
      emit_notification: {
        Args: {
          p_group_id: string
          p_match_id: string
          p_payload: Json
          p_type: string
        }
        Returns: undefined
      }
      emit_player_attendance_events: {
        Args: { p_player_id: string }
        Returns: undefined
      }
      finalize_match_results: {
        Args: { p_match_id: string }
        Returns: undefined
      }
      generate_recurring_matches: {
        Args: { p_group_id?: string }
        Returns: number
      }
      get_current_player_id: { Args: never; Returns: string }
      get_match_join_info: { Args: { p_match_id: string }; Returns: Json }
      get_match_mvp: { Args: { p_match_id: string }; Returns: string }
      get_member_scores: {
        Args: { p_group_id?: string }
        Returns: {
          group_id: string
          is_active: boolean
          member_breakdown: Json
          member_score: number
          member_score_at: string
          player_id: string
          signup_cooldown: boolean
        }[]
      }
      get_public_group_by_invite: {
        Args: { p_invite_code: string }
        Returns: Json
      }
      get_public_match: { Args: { p_match_id: string }; Returns: Json }
      get_recent_match_history: {
        Args: { p_group_id: string; p_limit?: number }
        Returns: {
          dark_team_players: Json
          light_team_players: Json
          match_date: string
          match_id: string
        }[]
      }
      get_results_window_days: {
        Args: { p_group_ids: string[] }
        Returns: {
          group_id: string
          results_window_days: number
        }[]
      }
      get_unread_notification_count: { Args: never; Returns: number }
      insert_member_event: {
        Args: {
          p_group_id: string
          p_match_id: string
          p_note?: string
          p_player_id: string
          p_points?: number
          p_reported_by?: string
          p_source: Database["public"]["Enums"]["member_event_source"]
          p_subject_id: string
          p_type: Database["public"]["Enums"]["member_event_type"]
        }
        Returns: boolean
      }
      is_group_admin: { Args: { group_uuid: string }; Returns: boolean }
      is_group_admin_or_captain: {
        Args: { group_uuid: string }
        Returns: boolean
      }
      is_group_member: { Args: { group_uuid: string }; Returns: boolean }
      is_service_role: { Args: never; Returns: boolean }
      join_group_via_invite: {
        Args: { p_invite_code: string }
        Returns: {
          group_id: string
          id: string
          is_active: boolean | null
          joined_at: string | null
          member_breakdown: Json | null
          member_score: number | null
          member_score_at: string | null
          player_id: string
          role: Database["public"]["Enums"]["group_role"] | null
          signup_cooldown: boolean
        }
        SetofOptions: {
          from: "*"
          to: "group_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leave_group: { Args: { p_group_id: string }; Returns: undefined }
      list_my_notifications: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          group_id: string
          id: string
          is_read: boolean
          match_id: string
          payload: Json
          recipient_player_id: string
          type: string
        }[]
      }
      mark_all_notifications_read: { Args: never; Returns: undefined }
      mark_notifications_read: { Args: { p_ids: string[] }; Returns: undefined }
      match_badge_eligibility: {
        Args: { p_match_id: string }
        Returns: {
          badge_type: string
          player_id: string
        }[]
      }
      match_report_url: { Args: { p_match_id: string }; Returns: string }
      match_report_window_open: {
        Args: { p_match_id: string }
        Returns: boolean
      }
      member_scoring_settings: { Args: { p_group_id: string }; Returns: Json }
      notification_visible_to: {
        Args: {
          n: Database["public"]["Tables"]["notifications"]["Row"]
          p_player: string
          p_prefs: Json
        }
        Returns: boolean
      }
      post_match_result_if_changed: {
        Args: { p_group_post?: boolean; p_match_id: string }
        Returns: boolean
      }
      promote_from_waitlist: { Args: { p_match_id: string }; Returns: string }
      public_guest_signup: {
        Args: { p_display_name: string; p_match_id: string; p_token: string }
        Returns: Json
      }
      publish_match_teams: {
        Args: { p_assignments: Json; p_match_id: string; p_snapshot?: Json }
        Returns: undefined
      }
      push_audience_matches: {
        Args: {
          n: Database["public"]["Tables"]["notifications"]["Row"]
          player: string
        }
        Returns: boolean
      }
      recompute_group_member_scores: {
        Args: { p_group_id: string }
        Returns: undefined
      }
      recompute_match_consensus: {
        Args: { p_match_id: string }
        Returns: undefined
      }
      recompute_match_mvp: { Args: { p_match_id: string }; Returns: undefined }
      recompute_member_score: {
        Args: { p_group_id: string; p_player_id: string }
        Returns: undefined
      }
      recompute_player_rating: {
        Args: { p_player_id: string }
        Returns: undefined
      }
      recompute_player_stats: {
        Args: { p_player_id: string }
        Returns: undefined
      }
      regenerate_invite_code: { Args: { p_group_id: string }; Returns: string }
      result_weight: {
        Args: { p_group_id: string; p_player_id: string }
        Returns: number
      }
      run_priority_window_close_job: {
        Args: { p_match_id: string }
        Returns: boolean
      }
      run_results_reminder_job: {
        Args: { p_match_id: string; p_payload: Json }
        Returns: boolean
      }
      run_results_request_job: {
        Args: { p_match_id: string; p_payload: Json }
        Returns: boolean
      }
      run_results_window_close_job: {
        Args: { p_match_id: string }
        Returns: boolean
      }
      run_scheduled_job: { Args: { p_job_id: string }; Returns: Json }
      save_team_assignments: {
        Args: { p_assignments: Json; p_match_id: string }
        Returns: undefined
      }
      schedule_match_jobs: { Args: { p_match_id: string }; Returns: undefined }
      set_conduct_flag: {
        Args: {
          p_match_id: string
          p_on: boolean
          p_player_id: string
          p_type: Database["public"]["Enums"]["member_event_type"]
        }
        Returns: undefined
      }
      set_match_mvp: {
        Args: { p_match_id: string; p_new_mvp: string }
        Returns: undefined
      }
      signup_for_match: {
        Args: {
          p_match_id: string
          p_notes?: string
          p_position_preference?: string
        }
        Returns: {
          cancel_time: string | null
          guest_player_id: string | null
          id: string
          match_id: string
          notes: string | null
          player_id: string | null
          position_preference: string | null
          signup_time: string | null
          status: Database["public"]["Enums"]["signup_status"] | null
          waitlist_position: number | null
          waitlist_reason: string | null
        }
        SetofOptions: {
          from: "*"
          to: "match_signups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_match_report: {
        Args: {
          p_dark_goals_complete: boolean
          p_dark_score: number
          p_light_goals_complete: boolean
          p_light_score: number
          p_match_id: string
          p_mvp_candidate_id: string
          p_stats: Json
        }
        Returns: string
      }
      update_player_rating: { Args: { p_player_id: string }; Returns: number }
      usable_match_reports: {
        Args: { p_match_id: string }
        Returns: {
          created_at: string
          dark_goals_complete: boolean
          dark_score: number
          light_goals_complete: boolean
          light_score: number
          report_id: string
          reporter_player_id: string
          weight: number
        }[]
      }
    }
    Enums: {
      assignment_source: "ai" | "manual"
      fitness_status: "ok" | "limited" | "injured"
      footedness: "left" | "right" | "both"
      group_role: "admin" | "captain" | "member"
      match_status:
        | "draft"
        | "signup_open"
        | "full"
        | "teams_created"
        | "finished"
        | "cancelled"
        | "signup_closed"
      member_event_source: "system" | "admin" | "peer"
      member_event_type:
        | "attended"
        | "no_show"
        | "late_cancel"
        | "early_cancel"
        | "arrived_late"
        | "wrong_jersey"
        | "unpaid"
        | "paid"
        | "reported_result"
        | "rated_teammates"
        | "voted_mvp"
        | "rated_new_member"
        | "peer_kudos"
        | "admin_adjustment"
      rule_type:
        | "avoid_pair"
        | "force_pair"
        | "min_defenders"
        | "min_goalkeepers"
        | "balance_rating"
      signup_status: "confirmed" | "waitlist" | "cancelled" | "did_not_show"
      team_name: "dark" | "light"
      user_language: "es" | "en"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      assignment_source: ["ai", "manual"],
      fitness_status: ["ok", "limited", "injured"],
      footedness: ["left", "right", "both"],
      group_role: ["admin", "captain", "member"],
      match_status: [
        "draft",
        "signup_open",
        "full",
        "teams_created",
        "finished",
        "cancelled",
        "signup_closed",
      ],
      member_event_source: ["system", "admin", "peer"],
      member_event_type: [
        "attended",
        "no_show",
        "late_cancel",
        "early_cancel",
        "arrived_late",
        "wrong_jersey",
        "unpaid",
        "paid",
        "reported_result",
        "rated_teammates",
        "voted_mvp",
        "rated_new_member",
        "peer_kudos",
        "admin_adjustment",
      ],
      rule_type: [
        "avoid_pair",
        "force_pair",
        "min_defenders",
        "min_goalkeepers",
        "balance_rating",
      ],
      signup_status: ["confirmed", "waitlist", "cancelled", "did_not_show"],
      team_name: ["dark", "light"],
      user_language: ["es", "en"],
    },
  },
} as const

