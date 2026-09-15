export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_reviews: {
        Row: {
          account_ref: string
          evidence_source: string
          id: string
          next_review_at: string
          notes: string | null
          review_period: string
          review_status: string
          reviewed_at: string
          reviewed_by_domain: string
          role_name: string
          system_name: string
        }
        Insert: {
          account_ref: string
          evidence_source: string
          id?: string
          next_review_at: string
          notes?: string | null
          review_period: string
          review_status: string
          reviewed_at: string
          reviewed_by_domain: string
          role_name: string
          system_name: string
        }
        Update: {
          account_ref?: string
          evidence_source?: string
          id?: string
          next_review_at?: string
          notes?: string | null
          review_period?: string
          review_status?: string
          reviewed_at?: string
          reviewed_by_domain?: string
          role_name?: string
          system_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_reviews_reviewed_by_domain_fkey"
            columns: ["reviewed_by_domain"]
            isOneToOne: false
            referencedRelation: "governance_domain_owners"
            referencedColumns: ["domain"]
          },
        ]
      }
      analysis_draft_games: {
        Row: {
          campeonato: string
          draft_id: string
          editable_fields: string[]
          horario: string
          id: string
          ignored: boolean
          ordinal: number
          partida: string
          resolved_away_team: string | null
          resolved_competition: string | null
          resolved_event_id: number | null
          resolved_home_team: string | null
          resolved_kickoff: string | null
          resolver_confidence: number | null
          suggestions: Json
          target_date: string | null
          updated_at: string
          validation_errors: Json
          validation_status: string
        }
        Insert: {
          campeonato: string
          draft_id: string
          editable_fields?: string[]
          horario: string
          id?: string
          ignored?: boolean
          ordinal: number
          partida: string
          resolved_away_team?: string | null
          resolved_competition?: string | null
          resolved_event_id?: number | null
          resolved_home_team?: string | null
          resolved_kickoff?: string | null
          resolver_confidence?: number | null
          suggestions?: Json
          target_date?: string | null
          updated_at?: string
          validation_errors?: Json
          validation_status?: string
        }
        Update: {
          campeonato?: string
          draft_id?: string
          editable_fields?: string[]
          horario?: string
          id?: string
          ignored?: boolean
          ordinal?: number
          partida?: string
          resolved_away_team?: string | null
          resolved_competition?: string | null
          resolved_event_id?: number | null
          resolved_home_team?: string | null
          resolved_kickoff?: string | null
          resolver_confidence?: number | null
          suggestions?: Json
          target_date?: string | null
          updated_at?: string
          validation_errors?: Json
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_draft_games_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "analysis_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_drafts: {
        Row: {
          client_request_id: string
          created_at: string
          filename: string
          final_run_id: string | null
          headers: string[]
          id: string
          invalid_count: number
          leagues: string[]
          owner_id: string
          status: string
          target_date: string | null
          updated_at: string
        }
        Insert: {
          client_request_id: string
          created_at?: string
          filename: string
          final_run_id?: string | null
          headers?: string[]
          id?: string
          invalid_count?: number
          leagues?: string[]
          owner_id: string
          status?: string
          target_date?: string | null
          updated_at?: string
        }
        Update: {
          client_request_id?: string
          created_at?: string
          filename?: string
          final_run_id?: string | null
          headers?: string[]
          id?: string
          invalid_count?: number
          leagues?: string[]
          owner_id?: string
          status?: string
          target_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_drafts_final_run_id_fkey"
            columns: ["final_run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          completed_steps: string[]
          created_at: string
          current_step: string | null
          dispatch_token: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          locked_at: string | null
          run_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          completed_steps?: string[]
          created_at?: string
          current_step?: string | null
          dispatch_token?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          locked_at?: string | null
          run_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          completed_steps?: string[]
          created_at?: string
          current_step?: string | null
          dispatch_token?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          locked_at?: string | null
          run_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_jobs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_runs: {
        Row: {
          candidates_blocked: number
          candidates_published: number
          created_at: string
          current_step: string | null
          id: string
          idempotency_key: string | null
          matches_failed: number
          matches_resolved: number
          matches_total: number
          notes: Json
          owner_id: string
          selection_finalized_at: string | null
          selections_count: number
          status: string
          target_date: string | null
          updated_at: string
        }
        Insert: {
          candidates_blocked?: number
          candidates_published?: number
          created_at?: string
          current_step?: string | null
          id?: string
          idempotency_key?: string | null
          matches_failed?: number
          matches_resolved?: number
          matches_total?: number
          notes?: Json
          owner_id?: string
          selection_finalized_at?: string | null
          selections_count?: number
          status?: string
          target_date?: string | null
          updated_at?: string
        }
        Update: {
          candidates_blocked?: number
          candidates_published?: number
          created_at?: string
          current_step?: string | null
          id?: string
          idempotency_key?: string | null
          matches_failed?: number
          matches_resolved?: number
          matches_total?: number
          notes?: Json
          owner_id?: string
          selection_finalized_at?: string | null
          selections_count?: number
          status?: string
          target_date?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      app_schema_releases: {
        Row: {
          applied_at: string
          checksum: string | null
          git_sha: string | null
          migration_name: string
          notes: string | null
          version: string
        }
        Insert: {
          applied_at?: string
          checksum?: string | null
          git_sha?: string | null
          migration_name: string
          notes?: string | null
          version: string
        }
        Update: {
          applied_at?: string
          checksum?: string | null
          git_sha?: string | null
          migration_name?: string
          notes?: string | null
          version?: string
        }
        Relationships: []
      }
      automation_runs: {
        Row: {
          error_message: string | null
          finished_at: string | null
          http_status: number | null
          id: number
          job_name: string
          metadata: Json
          request_id: number | null
          started_at: string
          status: string
        }
        Insert: {
          error_message?: string | null
          finished_at?: string | null
          http_status?: number | null
          id?: never
          job_name: string
          metadata?: Json
          request_id?: number | null
          started_at?: string
          status?: string
        }
        Update: {
          error_message?: string | null
          finished_at?: string | null
          http_status?: number | null
          id?: never
          job_name?: string
          metadata?: Json
          request_id?: number | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      decision_opportunity_queue: {
        Row: {
          batch_no: number | null
          competition: string | null
          created_at: string
          edge: number | null
          entry_odd: number
          expected_value: number | null
          fair_odd: number | null
          id: string
          line_canonical: number | null
          market: string
          market_family: string
          market_label: string
          match_id: string | null
          match_label: string
          min_odd_target: number | null
          model_probability: number
          model_status: string
          model_version: string
          participant: string | null
          prediction_id: string
          queue_state: string
          rank_global: number
          run_id: string
          side: string | null
          updated_at: string
        }
        Insert: {
          batch_no?: number | null
          competition?: string | null
          created_at?: string
          edge?: number | null
          entry_odd: number
          expected_value?: number | null
          fair_odd?: number | null
          id?: string
          line_canonical?: number | null
          market: string
          market_family: string
          market_label: string
          match_id?: string | null
          match_label: string
          min_odd_target?: number | null
          model_probability: number
          model_status: string
          model_version: string
          participant?: string | null
          prediction_id: string
          queue_state?: string
          rank_global: number
          run_id: string
          side?: string | null
          updated_at?: string
        }
        Update: {
          batch_no?: number | null
          competition?: string | null
          created_at?: string
          edge?: number | null
          entry_odd?: number
          expected_value?: number | null
          fair_odd?: number | null
          id?: string
          line_canonical?: number | null
          market?: string
          market_family?: string
          market_label?: string
          match_id?: string | null
          match_label?: string
          min_odd_target?: number | null
          model_probability?: number
          model_status?: string
          model_version?: string
          participant?: string | null
          prediction_id?: string
          queue_state?: string
          rank_global?: number
          run_id?: string
          side?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_opportunity_queue_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_opportunity_queue_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      elo_audit_runs: {
        Row: {
          generated_at: string
          id: string
          issues: Json
          model_version: string
          status: string
          summary: Json
        }
        Insert: {
          generated_at?: string
          id?: string
          issues?: Json
          model_version: string
          status: string
          summary: Json
        }
        Update: {
          generated_at?: string
          id?: string
          issues?: Json
          model_version?: string
          status?: string
          summary?: Json
        }
        Relationships: []
      }
      elo_cross_competitions: {
        Row: {
          active: boolean
          competition_id: number
          competition_name: string
          last_sync_error: string | null
          last_sync_status: string | null
          last_synced_at: string | null
          region: string
        }
        Insert: {
          active?: boolean
          competition_id: number
          competition_name: string
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          region: string
        }
        Update: {
          active?: boolean
          competition_id?: number
          competition_name?: string
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          region?: string
        }
        Relationships: []
      }
      elo_cross_fixtures: {
        Row: {
          away_goals: number
          away_team_id: number
          away_team_name: string
          competition_id: number
          competition_name: string
          fetched_at: string
          fixture_id: number
          home_goals: number
          home_team_id: number
          home_team_name: string
          kickoff_at: string
          region: string
          updated_at: string
        }
        Insert: {
          away_goals: number
          away_team_id: number
          away_team_name: string
          competition_id: number
          competition_name: string
          fetched_at?: string
          fixture_id: number
          home_goals: number
          home_team_id: number
          home_team_name: string
          kickoff_at: string
          region: string
          updated_at?: string
        }
        Update: {
          away_goals?: number
          away_team_id?: number
          away_team_name?: string
          competition_id?: number
          competition_name?: string
          fetched_at?: string
          fixture_id?: number
          home_goals?: number
          home_team_id?: number
          home_team_name?: string
          kickoff_at?: string
          region?: string
          updated_at?: string
        }
        Relationships: []
      }
      elo_fixture_history: {
        Row: {
          actual_home_score: number
          away_goals: number
          away_rating_after: number
          away_rating_before: number
          away_team_id: number
          away_team_name: string
          created_at: string
          elo_delta: number
          expected_home_score: number
          fixture_id: number
          home_advantage_points: number
          home_goals: number
          home_rating_after: number
          home_rating_before: number
          home_team_id: number
          home_team_name: string
          kickoff_at: string
          league_id: number
          league_key: string
          league_name: string
          model_version: string
        }
        Insert: {
          actual_home_score: number
          away_goals: number
          away_rating_after: number
          away_rating_before: number
          away_team_id: number
          away_team_name: string
          created_at?: string
          elo_delta: number
          expected_home_score: number
          fixture_id: number
          home_advantage_points: number
          home_goals: number
          home_rating_after: number
          home_rating_before: number
          home_team_id: number
          home_team_name: string
          kickoff_at: string
          league_id: number
          league_key: string
          league_name: string
          model_version: string
        }
        Update: {
          actual_home_score?: number
          away_goals?: number
          away_rating_after?: number
          away_rating_before?: number
          away_team_id?: number
          away_team_name?: string
          created_at?: string
          elo_delta?: number
          expected_home_score?: number
          fixture_id?: number
          home_advantage_points?: number
          home_goals?: number
          home_rating_after?: number
          home_rating_before?: number
          home_team_id?: number
          home_team_name?: string
          kickoff_at?: string
          league_id?: number
          league_key?: string
          league_name?: string
          model_version?: string
        }
        Relationships: []
      }
      elo_fixtures: {
        Row: {
          away_goals: number
          away_team_id: number
          away_team_name: string
          country_code: string | null
          fetched_at: string
          fixture_id: number
          home_goals: number
          home_team_id: number
          home_team_name: string
          kickoff_at: string
          league_id: number
          league_key: string
          league_name: string
          source: string
          updated_at: string
        }
        Insert: {
          away_goals: number
          away_team_id: number
          away_team_name: string
          country_code?: string | null
          fetched_at?: string
          fixture_id: number
          home_goals: number
          home_team_id: number
          home_team_name: string
          kickoff_at: string
          league_id: number
          league_key: string
          league_name: string
          source?: string
          updated_at?: string
        }
        Update: {
          away_goals?: number
          away_team_id?: number
          away_team_name?: string
          country_code?: string | null
          fetched_at?: string
          fixture_id?: number
          home_goals?: number
          home_team_id?: number
          home_team_name?: string
          kickoff_at?: string
          league_id?: number
          league_key?: string
          league_name?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      elo_league_fixture_history: {
        Row: {
          actual_home_score: number
          away_global_rating_before: number
          away_league_id: number
          away_league_key: string
          away_league_rating_after: number
          away_league_rating_before: number
          away_local_rating: number
          away_team_id: number
          competition_id: number
          competition_name: string
          created_at: string
          expected_home_score: number
          fixture_id: number
          home_global_rating_before: number
          home_league_id: number
          home_league_key: string
          home_league_rating_after: number
          home_league_rating_before: number
          home_local_rating: number
          home_team_id: number
          kickoff_at: string
          league_delta: number
          model_version: string
        }
        Insert: {
          actual_home_score: number
          away_global_rating_before: number
          away_league_id: number
          away_league_key: string
          away_league_rating_after: number
          away_league_rating_before: number
          away_local_rating: number
          away_team_id: number
          competition_id: number
          competition_name: string
          created_at?: string
          expected_home_score: number
          fixture_id: number
          home_global_rating_before: number
          home_league_id: number
          home_league_key: string
          home_league_rating_after: number
          home_league_rating_before: number
          home_local_rating: number
          home_team_id: number
          kickoff_at: string
          league_delta: number
          model_version: string
        }
        Update: {
          actual_home_score?: number
          away_global_rating_before?: number
          away_league_id?: number
          away_league_key?: string
          away_league_rating_after?: number
          away_league_rating_before?: number
          away_local_rating?: number
          away_team_id?: number
          competition_id?: number
          competition_name?: string
          created_at?: string
          expected_home_score?: number
          fixture_id?: number
          home_global_rating_before?: number
          home_league_id?: number
          home_league_key?: string
          home_league_rating_after?: number
          home_league_rating_before?: number
          home_local_rating?: number
          home_team_id?: number
          kickoff_at?: string
          league_delta?: number
          model_version?: string
        }
        Relationships: []
      }
      elo_league_ratings: {
        Row: {
          country_code: string
          division_level: number
          evidence_adjustment: number
          evidence_matches: number
          focus_role: string
          hierarchy_constrained: boolean
          league_id: number
          league_key: string
          league_name: string
          model_version: string
          prior_rating: number
          rating: number
          region: string
          updated_at: string
        }
        Insert: {
          country_code: string
          division_level: number
          evidence_adjustment?: number
          evidence_matches?: number
          focus_role: string
          hierarchy_constrained?: boolean
          league_id: number
          league_key: string
          league_name: string
          model_version: string
          prior_rating: number
          rating: number
          region: string
          updated_at?: string
        }
        Update: {
          country_code?: string
          division_level?: number
          evidence_adjustment?: number
          evidence_matches?: number
          focus_role?: string
          hierarchy_constrained?: boolean
          league_id?: number
          league_key?: string
          league_name?: string
          model_version?: string
          prior_rating?: number
          rating?: number
          region?: string
          updated_at?: string
        }
        Relationships: []
      }
      elo_prediction_context: {
        Row: {
          adjusted_lambda_away: number
          adjusted_lambda_home: number
          away_global_rating: number | null
          away_league_id: number | null
          away_league_rating: number | null
          away_rating: number
          away_team_id: number
          base_lambda_away: number
          base_lambda_home: number
          created_at: string
          elo_delta: number
          elo_scope: string | null
          home_global_rating: number | null
          home_league_id: number | null
          home_league_rating: number | null
          home_rating: number
          home_team_id: number
          league_id: number
          match_id: string
          model_version: string
          prediction_at: string
          run_id: string
        }
        Insert: {
          adjusted_lambda_away: number
          adjusted_lambda_home: number
          away_global_rating?: number | null
          away_league_id?: number | null
          away_league_rating?: number | null
          away_rating: number
          away_team_id: number
          base_lambda_away: number
          base_lambda_home: number
          created_at?: string
          elo_delta: number
          elo_scope?: string | null
          home_global_rating?: number | null
          home_league_id?: number | null
          home_league_rating?: number | null
          home_rating: number
          home_team_id: number
          league_id: number
          match_id: string
          model_version: string
          prediction_at: string
          run_id: string
        }
        Update: {
          adjusted_lambda_away?: number
          adjusted_lambda_home?: number
          away_global_rating?: number | null
          away_league_id?: number | null
          away_league_rating?: number | null
          away_rating?: number
          away_team_id?: number
          base_lambda_away?: number
          base_lambda_home?: number
          created_at?: string
          elo_delta?: number
          elo_scope?: string | null
          home_global_rating?: number | null
          home_league_id?: number | null
          home_league_rating?: number | null
          home_rating?: number
          home_team_id?: number
          league_id?: number
          match_id?: string
          model_version?: string
          prediction_at?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "elo_prediction_context_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elo_prediction_context_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elo_prediction_context_run_match_fkey"
            columns: ["run_id", "match_id"]
            isOneToOne: true
            referencedRelation: "matches"
            referencedColumns: ["run_id", "id"]
          },
        ]
      }
      elo_seed_rebuild_queue: {
        Row: {
          league_id: number
          pass1_done: boolean
          pass2_done: boolean
          updated_at: string
        }
        Insert: {
          league_id: number
          pass1_done?: boolean
          pass2_done?: boolean
          updated_at?: string
        }
        Update: {
          league_id?: number
          pass1_done?: boolean
          pass2_done?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      elo_sync_state: {
        Row: {
          api_requests: number
          details: Json
          error_message: string | null
          fixtures_fetched: number
          id: string
          last_completed_at: string | null
          last_started_at: string | null
          last_status: string
          leagues_processed: number
          model_version: string
          source: string
          updated_at: string
        }
        Insert: {
          api_requests?: number
          details?: Json
          error_message?: string | null
          fixtures_fetched?: number
          id?: string
          last_completed_at?: string | null
          last_started_at?: string | null
          last_status?: string
          leagues_processed?: number
          model_version: string
          source?: string
          updated_at?: string
        }
        Update: {
          api_requests?: number
          details?: Json
          error_message?: string | null
          fixtures_fetched?: number
          id?: string
          last_completed_at?: string | null
          last_started_at?: string | null
          last_status?: string
          leagues_processed?: number
          model_version?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      elo_target_leagues: {
        Row: {
          active: boolean
          country_code: string
          created_at: string
          division_level: number
          focus_role: string
          last_sync_error: string | null
          last_sync_status: string | null
          last_synced_at: string | null
          league_id: number
          league_key: string
          league_name: string
          parent_league_key: string | null
          prior_rating: number
          region: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          country_code: string
          created_at?: string
          division_level?: number
          focus_role: string
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          league_id: number
          league_key: string
          league_name: string
          parent_league_key?: string | null
          prior_rating: number
          region: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          country_code?: string
          created_at?: string
          division_level?: number
          focus_role?: string
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          league_id?: number
          league_key?: string
          league_name?: string
          parent_league_key?: string | null
          prior_rating?: number
          region?: string
          updated_at?: string
        }
        Relationships: []
      }
      elo_team_ratings: {
        Row: {
          first_fixture_at: string | null
          last_fixture_at: string | null
          league_id: number
          league_key: string
          league_name: string
          matches_processed: number
          model_version: string
          rating: number
          team_id: number
          team_name: string
          updated_at: string
        }
        Insert: {
          first_fixture_at?: string | null
          last_fixture_at?: string | null
          league_id: number
          league_key: string
          league_name: string
          matches_processed?: number
          model_version: string
          rating: number
          team_id: number
          team_name: string
          updated_at?: string
        }
        Update: {
          first_fixture_at?: string | null
          last_fixture_at?: string | null
          league_id?: number
          league_key?: string
          league_name?: string
          matches_processed?: number
          model_version?: string
          rating?: number
          team_id?: number
          team_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      experimental_analysis_results: {
        Row: {
          analyzed_at: string
          result_payload: Json
          run_id: string
          updated_at: string
        }
        Insert: {
          analyzed_at?: string
          result_payload: Json
          run_id: string
          updated_at?: string
        }
        Update: {
          analyzed_at?: string
          result_payload?: Json
          run_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "experimental_analysis_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      experimental_bankroll_config: {
        Row: {
          created_at: string
          fractional_kelly: number
          id: string
          initial_bankroll: number
          max_stake_pct: number
          min_stake_brl: number
          owner_id: string | null
          start_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          fractional_kelly?: number
          id?: string
          initial_bankroll: number
          max_stake_pct?: number
          min_stake_brl?: number
          owner_id?: string | null
          start_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          fractional_kelly?: number
          id?: string
          initial_bankroll?: number
          max_stake_pct?: number
          min_stake_brl?: number
          owner_id?: string | null
          start_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      experimental_bet_tracking: {
        Row: {
          accepted_at: string | null
          bet_status: string
          closing_fetched_at: string | null
          closing_line: number | null
          closing_odd: number | null
          closing_source: string | null
          closing_stage: string | null
          clv_attempts: number
          clv_implied_delta: number | null
          clv_next_retry_at: string | null
          clv_pct: number | null
          clv_status: string | null
          competition: string | null
          created_at: string
          decision_edge: number | null
          decision_expected_value: number | null
          decision_odd: number | null
          decision_policy_version: string
          decision_quote_captured_at: string | null
          declined_at: string | null
          edge: number | null
          entry_odd: number
          execution_quote_captured_at: string | null
          execution_quote_source: string | null
          expected_value: number | null
          fair_odd: number | null
          id: string
          line_canonical: number | null
          market: string
          market_family: string
          market_label: string
          match_id: string | null
          match_label: string
          min_odd_target: number | null
          model_probability: number
          model_status: string
          model_version: string
          notes: string | null
          opening_line: number | null
          opening_odd: number | null
          participant: string | null
          prediction_id: string
          profit_brl: number | null
          profit_units: number | null
          result: string
          run_id: string
          selection_rank: number | null
          settled_at: string | null
          side: string | null
          stake_brl: number | null
          target_date: string | null
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          bet_status?: string
          closing_fetched_at?: string | null
          closing_line?: number | null
          closing_odd?: number | null
          closing_source?: string | null
          closing_stage?: string | null
          clv_attempts?: number
          clv_implied_delta?: number | null
          clv_next_retry_at?: string | null
          clv_pct?: number | null
          clv_status?: string | null
          competition?: string | null
          created_at?: string
          decision_edge?: number | null
          decision_expected_value?: number | null
          decision_odd?: number | null
          decision_policy_version?: string
          decision_quote_captured_at?: string | null
          declined_at?: string | null
          edge?: number | null
          entry_odd: number
          execution_quote_captured_at?: string | null
          execution_quote_source?: string | null
          expected_value?: number | null
          fair_odd?: number | null
          id?: string
          line_canonical?: number | null
          market: string
          market_family: string
          market_label: string
          match_id?: string | null
          match_label: string
          min_odd_target?: number | null
          model_probability: number
          model_status: string
          model_version: string
          notes?: string | null
          opening_line?: number | null
          opening_odd?: number | null
          participant?: string | null
          prediction_id: string
          profit_brl?: number | null
          profit_units?: number | null
          result?: string
          run_id: string
          selection_rank?: number | null
          settled_at?: string | null
          side?: string | null
          stake_brl?: number | null
          target_date?: string | null
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          bet_status?: string
          closing_fetched_at?: string | null
          closing_line?: number | null
          closing_odd?: number | null
          closing_source?: string | null
          closing_stage?: string | null
          clv_attempts?: number
          clv_implied_delta?: number | null
          clv_next_retry_at?: string | null
          clv_pct?: number | null
          clv_status?: string | null
          competition?: string | null
          created_at?: string
          decision_edge?: number | null
          decision_expected_value?: number | null
          decision_odd?: number | null
          decision_policy_version?: string
          decision_quote_captured_at?: string | null
          declined_at?: string | null
          edge?: number | null
          entry_odd?: number
          execution_quote_captured_at?: string | null
          execution_quote_source?: string | null
          expected_value?: number | null
          fair_odd?: number | null
          id?: string
          line_canonical?: number | null
          market?: string
          market_family?: string
          market_label?: string
          match_id?: string | null
          match_label?: string
          min_odd_target?: number | null
          model_probability?: number
          model_status?: string
          model_version?: string
          notes?: string | null
          opening_line?: number | null
          opening_odd?: number | null
          participant?: string | null
          prediction_id?: string
          profit_brl?: number | null
          profit_units?: number | null
          result?: string
          run_id?: string
          selection_rank?: number | null
          settled_at?: string | null
          side?: string | null
          stake_brl?: number | null
          target_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "experimental_bet_tracking_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experimental_bet_tracking_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experimental_bet_tracking_run_match_fkey"
            columns: ["run_id", "match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["run_id", "id"]
          },
        ]
      }
      experimental_odds_snapshots: {
        Row: {
          api_market: string | null
          bookmaker: string
          created_at: string
          fetched_at: string
          fixture_id: number
          market: string
          match_id: string
          model_line: number | null
          odd: number | null
          offered_line: number | null
          prediction_id: string
          reason: string
          run_id: string
          side: string | null
          stage: string | null
          status: string
          updated_at: string
        }
        Insert: {
          api_market?: string | null
          bookmaker?: string
          created_at?: string
          fetched_at: string
          fixture_id: number
          market: string
          match_id: string
          model_line?: number | null
          odd?: number | null
          offered_line?: number | null
          prediction_id: string
          reason: string
          run_id: string
          side?: string | null
          stage?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          api_market?: string | null
          bookmaker?: string
          created_at?: string
          fetched_at?: string
          fixture_id?: number
          market?: string
          match_id?: string
          model_line?: number | null
          odd?: number | null
          offered_line?: number | null
          prediction_id?: string
          reason?: string
          run_id?: string
          side?: string | null
          stage?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "experimental_odds_snapshots_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experimental_odds_snapshots_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experimental_odds_snapshots_run_match_fkey"
            columns: ["run_id", "match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["run_id", "id"]
          },
        ]
      }
      experimental_value_evaluations: {
        Row: {
          bookmaker: string
          decision_probability: number | null
          edge: number | null
          evaluated_at: string
          evaluation_fingerprint: string
          execution_status: string
          expected_value: number | null
          fair_odd: number | null
          id: string
          line_canonical: number | null
          market: string
          market_family: string
          market_label: string
          match_id: string | null
          min_odd_target: number | null
          model_probability: number
          model_status: string
          model_version: string | null
          odd: number
          participant: string | null
          prediction_id: string
          price_source: string
          probability_status: string
          production_status: string
          rejection_reason: string | null
          run_id: string
          selected: boolean
          side: string | null
          value_status: string
        }
        Insert: {
          bookmaker?: string
          decision_probability?: number | null
          edge?: number | null
          evaluated_at?: string
          evaluation_fingerprint: string
          execution_status: string
          expected_value?: number | null
          fair_odd?: number | null
          id?: string
          line_canonical?: number | null
          market: string
          market_family: string
          market_label: string
          match_id?: string | null
          min_odd_target?: number | null
          model_probability: number
          model_status: string
          model_version?: string | null
          odd: number
          participant?: string | null
          prediction_id: string
          price_source?: string
          probability_status: string
          production_status: string
          rejection_reason?: string | null
          run_id: string
          selected?: boolean
          side?: string | null
          value_status: string
        }
        Update: {
          bookmaker?: string
          decision_probability?: number | null
          edge?: number | null
          evaluated_at?: string
          evaluation_fingerprint?: string
          execution_status?: string
          expected_value?: number | null
          fair_odd?: number | null
          id?: string
          line_canonical?: number | null
          market?: string
          market_family?: string
          market_label?: string
          match_id?: string | null
          min_odd_target?: number | null
          model_probability?: number
          model_status?: string
          model_version?: string | null
          odd?: number
          participant?: string | null
          prediction_id?: string
          price_source?: string
          probability_status?: string
          production_status?: string
          rejection_reason?: string | null
          run_id?: string
          selected?: boolean
          side?: string | null
          value_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "experimental_value_evaluations_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experimental_value_evaluations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      external_api_cache: {
        Row: {
          cache_key: string
          expires_at: string
          fetched_at: string
          http_status: number | null
          payload: Json
          provider: string
        }
        Insert: {
          cache_key: string
          expires_at: string
          fetched_at: string
          http_status?: number | null
          payload: Json
          provider: string
        }
        Update: {
          cache_key?: string
          expires_at?: string
          fetched_at?: string
          http_status?: number | null
          payload?: Json
          provider?: string
        }
        Relationships: []
      }
      external_api_capabilities: {
        Row: {
          capability_key: string
          enabled: boolean
          metadata: Json
          minimum_plan: string
          provider: string
          reason: string
          reviewed_at: string
        }
        Insert: {
          capability_key: string
          enabled: boolean
          metadata?: Json
          minimum_plan: string
          provider: string
          reason: string
          reviewed_at?: string
        }
        Update: {
          capability_key?: string
          enabled?: boolean
          metadata?: Json
          minimum_plan?: string
          provider?: string
          reason?: string
          reviewed_at?: string
        }
        Relationships: []
      }
      external_api_rate_limit_state: {
        Row: {
          bucket: string
          request_count: number
          updated_at: string
          window_started_at: string
        }
        Insert: {
          bucket: string
          request_count?: number
          updated_at?: string
          window_started_at: string
        }
        Update: {
          bucket?: string
          request_count?: number
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      external_api_rate_state: {
        Row: {
          blocked_until: string | null
          provider: string
          updated_at: string
          used_count: number
          window_started_at: string
        }
        Insert: {
          blocked_until?: string | null
          provider: string
          updated_at?: string
          used_count?: number
          window_started_at?: string
        }
        Update: {
          blocked_until?: string | null
          provider?: string
          updated_at?: string
          used_count?: number
          window_started_at?: string
        }
        Relationships: []
      }
      external_api_status_snapshots: {
        Row: {
          checked_at: string
          payload: Json
          plan: string | null
          provider: string
          reported_limit: number | null
        }
        Insert: {
          checked_at?: string
          payload?: Json
          plan?: string | null
          provider: string
          reported_limit?: number | null
        }
        Update: {
          checked_at?: string
          payload?: Json
          plan?: string | null
          provider?: string
          reported_limit?: number | null
        }
        Relationships: []
      }
      final_selections: {
        Row: {
          created_at: string
          evaluation_id: string
          explanation: string | null
          id: string
          rank: number
          run_id: string
        }
        Insert: {
          created_at?: string
          evaluation_id: string
          explanation?: string | null
          id?: string
          rank: number
          run_id: string
        }
        Update: {
          created_at?: string
          evaluation_id?: string
          explanation?: string | null
          id?: string
          rank?: number
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "final_selections_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "value_evaluations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "final_selections_run_evaluation_fkey"
            columns: ["run_id", "evaluation_id"]
            isOneToOne: true
            referencedRelation: "value_evaluations"
            referencedColumns: ["run_id", "id"]
          },
          {
            foreignKeyName: "final_selections_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      five_dollar_league_priors: {
        Row: {
          average_against: number | null
          average_for: number | null
          created_at: string
          id: string
          league_id: number
          played: number | null
          prior_type: string
          raw: Json
          round_label: string | null
          season: string | null
          snapshot_at: string
          snapshot_date: string
          source_kind: string | null
          team_id: number
          team_name: string
          total_against: number | null
          total_for: number | null
          updated_at: string
        }
        Insert: {
          average_against?: number | null
          average_for?: number | null
          created_at?: string
          id?: string
          league_id: number
          played?: number | null
          prior_type: string
          raw?: Json
          round_label?: string | null
          season?: string | null
          snapshot_at?: string
          snapshot_date: string
          source_kind?: string | null
          team_id: number
          team_name: string
          total_against?: number | null
          total_for?: number | null
          updated_at?: string
        }
        Update: {
          average_against?: number | null
          average_for?: number | null
          created_at?: string
          id?: string
          league_id?: number
          played?: number | null
          prior_type?: string
          raw?: Json
          round_label?: string | null
          season?: string | null
          snapshot_at?: string
          snapshot_date?: string
          source_kind?: string | null
          team_id?: number
          team_name?: string
          total_against?: number | null
          total_for?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      governance_change_log: {
        Row: {
          actor_db_role: string
          actor_user_id: string | null
          after_data: Json | null
          before_data: Json | null
          changed_at: string
          context: Json
          id: number
          operation: string
          record_key: string | null
          table_name: string
        }
        Insert: {
          actor_db_role: string
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          changed_at?: string
          context?: Json
          id?: never
          operation: string
          record_key?: string | null
          table_name: string
        }
        Update: {
          actor_db_role?: string
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          changed_at?: string
          context?: Json
          id?: never
          operation?: string
          record_key?: string | null
          table_name?: string
        }
        Relationships: []
      }
      governance_domain_owners: {
        Row: {
          approval_policy: string
          data_owner: string
          domain: string
          review_cadence_days: number
          technical_owner: string
          updated_at: string
        }
        Insert: {
          approval_policy: string
          data_owner: string
          domain: string
          review_cadence_days: number
          technical_owner: string
          updated_at?: string
        }
        Update: {
          approval_policy?: string
          data_owner?: string
          domain?: string
          review_cadence_days?: number
          technical_owner?: string
          updated_at?: string
        }
        Relationships: []
      }
      market_candidates: {
        Row: {
          block_reason: string | null
          confidence_score: number | null
          created_at: string
          data_quality_score: number | null
          data_status: string
          fair_odd_info: number | null
          id: string
          line_canonical: number | null
          line_raw: string | null
          market: string
          market_family: string
          market_label: string
          market_score: number | null
          match_id: string | null
          model_status: string
          p_cal: number | null
          p_cons: number | null
          participant: string | null
          prediction_id: string
          published: boolean
          reason_short: string | null
          run_id: string
          sample_reliability: number | null
          settlement_definition: string | null
          side: string | null
          sources: Json
          stability: number | null
          uncertainty: number | null
        }
        Insert: {
          block_reason?: string | null
          confidence_score?: number | null
          created_at?: string
          data_quality_score?: number | null
          data_status: string
          fair_odd_info?: number | null
          id?: string
          line_canonical?: number | null
          line_raw?: string | null
          market: string
          market_family: string
          market_label: string
          market_score?: number | null
          match_id?: string | null
          model_status: string
          p_cal?: number | null
          p_cons?: number | null
          participant?: string | null
          prediction_id: string
          published?: boolean
          reason_short?: string | null
          run_id: string
          sample_reliability?: number | null
          settlement_definition?: string | null
          side?: string | null
          sources?: Json
          stability?: number | null
          uncertainty?: number | null
        }
        Update: {
          block_reason?: string | null
          confidence_score?: number | null
          created_at?: string
          data_quality_score?: number | null
          data_status?: string
          fair_odd_info?: number | null
          id?: string
          line_canonical?: number | null
          line_raw?: string | null
          market?: string
          market_family?: string
          market_label?: string
          market_score?: number | null
          match_id?: string | null
          model_status?: string
          p_cal?: number | null
          p_cons?: number | null
          participant?: string | null
          prediction_id?: string
          published?: boolean
          reason_short?: string | null
          run_id?: string
          sample_reliability?: number | null
          settlement_definition?: string | null
          side?: string | null
          sources?: Json
          stability?: number | null
          uncertainty?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "market_candidates_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_candidates_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_candidates_run_match_fkey"
            columns: ["run_id", "match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["run_id", "id"]
          },
        ]
      }
      match_external_ids: {
        Row: {
          confidence: number | null
          created_at: string
          external_id: string
          id: string
          match_id: string
          source: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          external_id: string
          id?: string
          match_id: string
          source: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          external_id?: string
          id?: string
          match_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_external_ids_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          away_team: string | null
          competition: string | null
          country: string | null
          created_at: string
          home_team: string | null
          id: string
          kickoff_local: string | null
          raw_campeonato: string
          raw_horario: string
          raw_partida: string
          resolution_reason: string | null
          resolution_status: string
          resolver_confidence: number | null
          run_id: string
          season: string | null
          timezone: string
        }
        Insert: {
          away_team?: string | null
          competition?: string | null
          country?: string | null
          created_at?: string
          home_team?: string | null
          id?: string
          kickoff_local?: string | null
          raw_campeonato: string
          raw_horario: string
          raw_partida: string
          resolution_reason?: string | null
          resolution_status?: string
          resolver_confidence?: number | null
          run_id: string
          season?: string | null
          timezone?: string
        }
        Update: {
          away_team?: string | null
          competition?: string | null
          country?: string | null
          created_at?: string
          home_team?: string | null
          id?: string
          kickoff_local?: string | null
          raw_campeonato?: string
          raw_horario?: string
          raw_partida?: string
          resolution_reason?: string | null
          resolution_status?: string
          resolver_confidence?: number | null
          run_id?: string
          season?: string | null
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_definitions: {
        Row: {
          data_owner_domain: string
          definition_version: string
          display_name: string
          effective_from: string
          formula: string
          metric_key: string
          notes: string | null
          population: string
          status: string
          unit: string
        }
        Insert: {
          data_owner_domain: string
          definition_version: string
          display_name: string
          effective_from: string
          formula: string
          metric_key: string
          notes?: string | null
          population: string
          status: string
          unit: string
        }
        Update: {
          data_owner_domain?: string
          definition_version?: string
          display_name?: string
          effective_from?: string
          formula?: string
          metric_key?: string
          notes?: string | null
          population?: string
          status?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "metric_definitions_data_owner_domain_fkey"
            columns: ["data_owner_domain"]
            isOneToOne: false
            referencedRelation: "governance_domain_owners"
            referencedColumns: ["domain"]
          },
        ]
      }
      model_predictions: {
        Row: {
          calibration_version: string | null
          conservative_probability: number | null
          data_status: string
          id: string
          line_canonical: number | null
          line_raw: string | null
          market: string
          match_id: string | null
          model_probability: number | null
          model_status: string
          model_version: string | null
          outcome_distribution: Json
          p_cal: number | null
          participant: string | null
          prediction_at: string
          prediction_id: string
          run_id: string
          side: string | null
        }
        Insert: {
          calibration_version?: string | null
          conservative_probability?: number | null
          data_status: string
          id?: string
          line_canonical?: number | null
          line_raw?: string | null
          market: string
          match_id?: string | null
          model_probability?: number | null
          model_status: string
          model_version?: string | null
          outcome_distribution?: Json
          p_cal?: number | null
          participant?: string | null
          prediction_at?: string
          prediction_id: string
          run_id: string
          side?: string | null
        }
        Update: {
          calibration_version?: string | null
          conservative_probability?: number | null
          data_status?: string
          id?: string
          line_canonical?: number | null
          line_raw?: string | null
          market?: string
          match_id?: string | null
          model_probability?: number | null
          model_status?: string
          model_version?: string | null
          outcome_distribution?: Json
          p_cal?: number | null
          participant?: string | null
          prediction_at?: string
          prediction_id?: string
          run_id?: string
          side?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "model_predictions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_predictions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_predictions_run_match_fkey"
            columns: ["run_id", "match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["run_id", "id"]
          },
        ]
      }
      model_versions: {
        Row: {
          calibration_version: string | null
          created_at: string
          id: string
          market_family: string
          model_version: string
          out_of_sample_metrics: Json
          validation_status: string
        }
        Insert: {
          calibration_version?: string | null
          created_at?: string
          id?: string
          market_family: string
          model_version: string
          out_of_sample_metrics?: Json
          validation_status?: string
        }
        Update: {
          calibration_version?: string | null
          created_at?: string
          id?: string
          market_family?: string
          model_version?: string
          out_of_sample_metrics?: Json
          validation_status?: string
        }
        Relationships: []
      }
      normalized_match_stats: {
        Row: {
          created_at: string
          definition_version: string | null
          id: string
          lineage: Json
          match_id: string | null
          metric: string
          normalized_value: number | null
          run_id: string
          sample_size: number | null
          scope: string
          source: string | null
        }
        Insert: {
          created_at?: string
          definition_version?: string | null
          id?: string
          lineage?: Json
          match_id?: string | null
          metric: string
          normalized_value?: number | null
          run_id: string
          sample_size?: number | null
          scope: string
          source?: string | null
        }
        Update: {
          created_at?: string
          definition_version?: string | null
          id?: string
          lineage?: Json
          match_id?: string | null
          metric?: string
          normalized_value?: number | null
          run_id?: string
          sample_size?: number | null
          scope?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "normalized_match_stats_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_match_stats_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_match_stats_run_match_fkey"
            columns: ["run_id", "match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["run_id", "id"]
          },
        ]
      }
      performance_vitals: {
        Row: {
          created_at: string
          id: number
          metric: string
          rating: string
          route: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: number
          metric: string
          rating: string
          route: string
          value: number
        }
        Update: {
          created_at?: string
          id?: number
          metric?: string
          rating?: string
          route?: string
          value?: number
        }
        Relationships: []
      }
      pipeline_logs: {
        Row: {
          created_at: string
          id: string
          level: string
          message: string
          payload: Json
          run_id: string
          step: string
        }
        Insert: {
          created_at?: string
          id?: string
          level?: string
          message: string
          payload?: Json
          run_id: string
          step: string
        }
        Update: {
          created_at?: string
          id?: string
          level?: string
          message?: string
          payload?: Json
          run_id?: string
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_logs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_processing_activities: {
        Row: {
          active: boolean
          activity_key: string
          data_categories: string[]
          deletion_method: string
          lawful_basis: string
          purpose: string
          recipients: string[]
          retention_rule: string
          reviewed_at: string
          storage_locations: string[]
        }
        Insert: {
          active?: boolean
          activity_key: string
          data_categories: string[]
          deletion_method: string
          lawful_basis: string
          purpose: string
          recipients?: string[]
          retention_rule: string
          reviewed_at?: string
          storage_locations: string[]
        }
        Update: {
          active?: boolean
          activity_key?: string
          data_categories?: string[]
          deletion_method?: string
          lawful_basis?: string
          purpose?: string
          recipients?: string[]
          retention_rule?: string
          reviewed_at?: string
          storage_locations?: string[]
        }
        Relationships: []
      }
      privacy_retention_policies: {
        Row: {
          active: boolean
          deletion_action: string
          policy_key: string
          retention_basis: string
          retention_days: number | null
          reviewed_at: string
          target_scope: string
        }
        Insert: {
          active?: boolean
          deletion_action: string
          policy_key: string
          retention_basis: string
          retention_days?: number | null
          reviewed_at?: string
          target_scope: string
        }
        Update: {
          active?: boolean
          deletion_action?: string
          policy_key?: string
          retention_basis?: string
          retention_days?: number | null
          reviewed_at?: string
          target_scope?: string
        }
        Relationships: []
      }
      push_delivery_outbox: {
        Row: {
          attempts: number
          created_at: string
          delivery_state: Json
          event_key: string
          event_type: string
          id: string
          last_error: string | null
          lock_token: string | null
          locked_at: string | null
          next_attempt_at: string
          payload: Json
          sent_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivery_state?: Json
          event_key: string
          event_type: string
          id?: string
          last_error?: string | null
          lock_token?: string | null
          locked_at?: string | null
          next_attempt_at?: string
          payload?: Json
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          delivery_state?: Json
          event_key?: string
          event_type?: string
          id?: string
          last_error?: string | null
          lock_token?: string | null
          locked_at?: string | null
          next_attempt_at?: string
          payload?: Json
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      raw_observations: {
        Row: {
          definition_version: string | null
          fetched_at: string
          id: string
          match_id: string | null
          metric: string
          observation_key: string
          observed_at: string | null
          raw_value: Json | null
          run_id: string
          source: string
        }
        Insert: {
          definition_version?: string | null
          fetched_at?: string
          id?: string
          match_id?: string | null
          metric: string
          observation_key: string
          observed_at?: string | null
          raw_value?: Json | null
          run_id: string
          source: string
        }
        Update: {
          definition_version?: string | null
          fetched_at?: string
          id?: string
          match_id?: string | null
          metric?: string
          observation_key?: string
          observed_at?: string | null
          raw_value?: Json | null
          run_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_observations_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_observations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_observations_run_match_fkey"
            columns: ["run_id", "match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["run_id", "id"]
          },
          {
            foreignKeyName: "raw_observations_source_definition_fkey"
            columns: ["source", "definition_version"]
            isOneToOne: false
            referencedRelation: "source_definitions"
            referencedColumns: ["source", "definition_version"]
          },
        ]
      }
      source_definitions: {
        Row: {
          configured: boolean
          created_at: string
          data_owner_domain: string
          data_steward: string
          definition_version: string
          governance_status: string
          id: string
          license_or_terms: string | null
          metric_definitions: Json
          next_review_at: string
          notes: string | null
          provider: string | null
          quality_tier: string | null
          reviewed_at: string
          sla_expectation: string | null
          source: string
        }
        Insert: {
          configured?: boolean
          created_at?: string
          data_owner_domain: string
          data_steward: string
          definition_version: string
          governance_status: string
          id?: string
          license_or_terms?: string | null
          metric_definitions?: Json
          next_review_at: string
          notes?: string | null
          provider?: string | null
          quality_tier?: string | null
          reviewed_at: string
          sla_expectation?: string | null
          source: string
        }
        Update: {
          configured?: boolean
          created_at?: string
          data_owner_domain?: string
          data_steward?: string
          definition_version?: string
          governance_status?: string
          id?: string
          license_or_terms?: string | null
          metric_definitions?: Json
          next_review_at?: string
          notes?: string | null
          provider?: string | null
          quality_tier?: string | null
          reviewed_at?: string
          sla_expectation?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_definitions_data_owner_domain_fkey"
            columns: ["data_owner_domain"]
            isOneToOne: false
            referencedRelation: "governance_domain_owners"
            referencedColumns: ["domain"]
          },
        ]
      }
      source_fetches: {
        Row: {
          attempt: number
          definition_version: string | null
          error_message: string | null
          fetched_at: string
          http_status: number | null
          id: string
          match_id: string | null
          run_id: string
          source: string
          status: string
        }
        Insert: {
          attempt?: number
          definition_version?: string | null
          error_message?: string | null
          fetched_at?: string
          http_status?: number | null
          id?: string
          match_id?: string | null
          run_id: string
          source: string
          status: string
        }
        Update: {
          attempt?: number
          definition_version?: string | null
          error_message?: string | null
          fetched_at?: string
          http_status?: number | null
          id?: string
          match_id?: string | null
          run_id?: string
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_fetches_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_fetches_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_fetches_run_match_fkey"
            columns: ["run_id", "match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["run_id", "id"]
          },
          {
            foreignKeyName: "source_fetches_source_definition_fkey"
            columns: ["source", "definition_version"]
            isOneToOne: false
            referencedRelation: "source_definitions"
            referencedColumns: ["source", "definition_version"]
          },
        ]
      }
      uploaded_files: {
        Row: {
          created_at: string
          filename: string
          id: string
          invalid_row_count: number
          leagues: string[]
          raw_headers: string[]
          row_count: number
          run_id: string
        }
        Insert: {
          created_at?: string
          filename: string
          id?: string
          invalid_row_count?: number
          leagues?: string[]
          raw_headers?: string[]
          row_count?: number
          run_id: string
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          invalid_row_count?: number
          leagues?: string[]
          raw_headers?: string[]
          row_count?: number
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "uploaded_files_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_odds: {
        Row: {
          bookmaker: string
          candidate_id: string
          entered_at: string
          id: string
          line_at_entry: number | null
          odd: number
          run_id: string
        }
        Insert: {
          bookmaker?: string
          candidate_id: string
          entered_at?: string
          id?: string
          line_at_entry?: number | null
          odd: number
          run_id: string
        }
        Update: {
          bookmaker?: string
          candidate_id?: string
          entered_at?: string
          id?: string
          line_at_entry?: number | null
          odd?: number
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_odds_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "market_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_odds_run_candidate_fkey"
            columns: ["run_id", "candidate_id"]
            isOneToOne: true
            referencedRelation: "market_candidates"
            referencedColumns: ["run_id", "id"]
          },
          {
            foreignKeyName: "user_odds_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      value_evaluations: {
        Row: {
          candidate_id: string
          created_at: string
          edge_cons: number | null
          ev_cons: number | null
          execution_status: string
          fair_odd: number | null
          id: string
          implied_probability: number | null
          l_eff: number | null
          min_odd_target: number | null
          odd: number
          probability_status: string
          rejection_reason: string | null
          run_id: string
          value_status: string
          w_eff: number | null
        }
        Insert: {
          candidate_id: string
          created_at?: string
          edge_cons?: number | null
          ev_cons?: number | null
          execution_status: string
          fair_odd?: number | null
          id?: string
          implied_probability?: number | null
          l_eff?: number | null
          min_odd_target?: number | null
          odd: number
          probability_status: string
          rejection_reason?: string | null
          run_id: string
          value_status: string
          w_eff?: number | null
        }
        Update: {
          candidate_id?: string
          created_at?: string
          edge_cons?: number | null
          ev_cons?: number | null
          execution_status?: string
          fair_odd?: number | null
          id?: string
          implied_probability?: number | null
          l_eff?: number | null
          min_odd_target?: number | null
          odd?: number
          probability_status?: string
          rejection_reason?: string | null
          run_id?: string
          value_status?: string
          w_eff?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "value_evaluations_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "market_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "value_evaluations_run_candidate_fkey"
            columns: ["run_id", "candidate_id"]
            isOneToOne: true
            referencedRelation: "market_candidates"
            referencedColumns: ["run_id", "id"]
          },
          {
            foreignKeyName: "value_evaluations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      access_review_status: {
        Row: {
          account_ref: string | null
          next_review_at: string | null
          notes: string | null
          overdue: boolean | null
          review_status: string | null
          reviewed_at: string | null
          role_name: string | null
          system_name: string | null
        }
        Insert: {
          account_ref?: string | null
          next_review_at?: string | null
          notes?: string | null
          overdue?: never
          review_status?: string | null
          reviewed_at?: string | null
          role_name?: string | null
          system_name?: string | null
        }
        Update: {
          account_ref?: string | null
          next_review_at?: string | null
          notes?: string | null
          overdue?: never
          review_status?: string | null
          reviewed_at?: string | null
          role_name?: string | null
          system_name?: string | null
        }
        Relationships: []
      }
      elo_audit_leagues: {
        Row: {
          audit_status: string | null
          country_code: string | null
          division_level: number | null
          evidence_adjustment: number | null
          evidence_matches: number | null
          focus_role: string | null
          hierarchy_constrained: boolean | null
          hierarchy_ok: boolean | null
          last_fixture_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          last_synced_at: string | null
          league_id: number | null
          league_key: string | null
          league_name: string | null
          league_rating: number | null
          local_avg_rating: number | null
          local_max_rating: number | null
          local_mean_drift: number | null
          local_min_rating: number | null
          parent_league_key: string | null
          parent_league_rating: number | null
          prior_rating: number | null
          region: string | null
          teams: number | null
        }
        Relationships: []
      }
      elo_global_team_ratings: {
        Row: {
          first_fixture_at: string | null
          global_rating: number | null
          last_fixture_at: string | null
          league_id: number | null
          league_key: string | null
          league_name: string | null
          league_rating: number | null
          local_rating: number | null
          matches_processed: number | null
          team_id: number | null
          team_model_version: string | null
          team_name: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      elo_team_integrity_audit: {
        Row: {
          first_fixture_mismatch_rows: number | null
          last_fixture_mismatch_rows: number | null
          match_count_mismatch_rows: number | null
          max_matches_processed: number | null
          max_rating: number | null
          metadata_mismatch_rows: number | null
          min_matches_processed: number | null
          min_rating: number | null
          missing_history_rows: number | null
          orphan_target_rows: number | null
          rating_mismatch_rows: number | null
          team_rows: number | null
          zero_match_rows: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_decision_opportunity_atomic: {
        Args: { p_owner_id: string; p_queue_id: string }
        Returns: {
          accepted: boolean
          accepted_count: number
          ready_for_stake: boolean
        }[]
      }
      acquire_external_api_slot: {
        Args: {
          p_limit?: number
          p_provider: string
          p_window_seconds?: number
        }
        Returns: {
          allowed: boolean
          remaining: number
          reset_at: string
        }[]
      }
      app_create_run_atomic: {
        Args: {
          p_filename: string
          p_headers: string[]
          p_invalid_count: number
          p_leagues: string[]
          p_prediction_at: string
          p_rows: Json
          p_target_date: string
        }
        Returns: string
      }
      app_replace_value_results_atomic: {
        Args: {
          p_completed_at?: string
          p_evaluations: Json
          p_run_id: string
          p_selections: Json
          p_user_odds: Json
        }
        Returns: Json
      }
      apply_analysis_draft_corrections: {
        Args: { p_corrections: Json; p_draft_id: string; p_owner_id: string }
        Returns: number
      }
      backfill_five_dollar_model_history_window: {
        Args: { p_end: string; p_start: string }
        Returns: number
      }
      claim_analysis_job: {
        Args: { p_dispatch_token: string; p_run_id: string }
        Returns: {
          attempts: number
          completed_steps: string[]
          lease_token: string
          run_id: string
          user_id: string
        }[]
      }
      claim_model_validation: {
        Args: { p_dispatch_token: string; p_job_id: string }
        Returns: {
          accepted: boolean
          market_family: string
          protocol_version: string
          target_calibration_version: string
          target_model_version: string
        }[]
      }
      claim_push_delivery_batch: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          created_at: string
          delivery_state: Json
          event_key: string
          event_type: string
          id: string
          last_error: string | null
          lock_token: string | null
          locked_at: string | null
          next_attempt_at: string
          payload: Json
          sent_at: string | null
          status: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "push_delivery_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_stage4_model_validation: {
        Args: { p_dispatch_token: string; p_job_id: string }
        Returns: {
          accepted: boolean
          target_model_version: string
        }[]
      }
      cleanup_external_api_cache: { Args: never; Returns: number }
      complete_analysis_job_step_atomic: {
        Args: {
          p_finished: boolean
          p_lease_token: string
          p_run_id: string
          p_step: string
        }
        Returns: {
          accepted: boolean
        }[]
      }
      complete_model_validation: {
        Args: {
          p_dispatch_token: string
          p_error?: string
          p_job_id: string
          p_report: Json
        }
        Returns: boolean
      }
      complete_push_delivery_event: {
        Args: { p_delivery_state: Json; p_id: string; p_lock_token: string }
        Returns: boolean
      }
      complete_stage4_model_validation: {
        Args: {
          p_dispatch_token: string
          p_error?: string
          p_job_id: string
          p_report: Json
        }
        Returns: boolean
      }
      complete_stage8_model_error_audit: {
        Args: {
          p_dispatch_token: string
          p_error?: string
          p_job_id: string
          p_report: Json
        }
        Returns: boolean
      }
      confirm_experimental_bet_atomic: {
        Args: {
          p_edge: number
          p_entry_odd: number
          p_expected_value: number
          p_id: string
          p_line_canonical: number
          p_quote_captured_at: string
          p_stake_brl: number
        }
        Returns: {
          available_after: number
          max_allowed: number
          minimum_stake: number
          stake_brl: number
          status: string
        }[]
      }
      create_analysis_draft_atomic: {
        Args: {
          p_client_request_id: string
          p_filename: string
          p_headers: string[]
          p_invalid_count: number
          p_leagues: string[]
          p_owner_id: string
          p_rows: Json
          p_target_date: string
        }
        Returns: {
          draft_id: string
          reused: boolean
        }[]
      }
      create_analysis_run_atomic: {
        Args: {
          p_filename: string
          p_headers: string[]
          p_idempotency_key: string
          p_invalid_count: number
          p_leagues: string[]
          p_owner_id: string
          p_rows: Json
          p_target_date: string
        }
        Returns: {
          reused: boolean
          run_id: string
        }[]
      }
      create_scheduled_analysis_run_atomic: {
        Args: { p_fixtures: Json; p_owner_id: string; p_target_date: string }
        Returns: {
          reused: boolean
          run_id: string
        }[]
      }
      decline_decision_opportunity_atomic: {
        Args: { p_owner_id: string; p_queue_id: string }
        Returns: {
          accepted_count: number
          declined: boolean
          exhausted: boolean
        }[]
      }
      elo_bootstrap_runner: { Args: never; Returns: Json }
      elo_finalize_daily: { Args: never; Returns: Json }
      elo_is_target_league: {
        Args: { p_country: string; p_name: string }
        Returns: boolean
      }
      elo_league_key: {
        Args: { p_country: string; p_name: string }
        Returns: string
      }
      elo_rebuild_league: { Args: { p_league_id: number }; Returns: Json }
      elo_rebuild_league_ratings: { Args: never; Returns: Json }
      elo_refresh_cross_fixtures_from_raw: { Args: never; Returns: Json }
      elo_run_audit: { Args: never; Returns: Json }
      elo_seed_rating: {
        Args: { p_before: string; p_new_league_id: number; p_team_id: number }
        Returns: number
      }
      elo_seed_rebuild_runner: { Args: never; Returns: Json }
      elo_store_5dollar_key: { Args: { p_key: string }; Returns: undefined }
      elo_sync_cross_competition: {
        Args: { p_competition_id: number }
        Returns: Json
      }
      elo_sync_domestic_league: { Args: { p_league_id: number }; Returns: Json }
      elo_sync_from_5dollar: { Args: never; Returns: Json }
      elo_sync_next_target: { Args: never; Returns: Json }
      elo_sync_next_target_when_idle: { Args: never; Returns: Json }
      enqueue_analysis_job_atomic: {
        Args: { p_run_id: string; p_user_id: string }
        Returns: {
          created: boolean
          status: string
        }[]
      }
      enqueue_push_delivery_event: {
        Args: {
          p_event_key: string
          p_event_type: string
          p_payload?: Json
          p_user_id: string
        }
        Returns: string
      }
      enqueue_scheduled_analysis_job_atomic: {
        Args: { p_run_id: string; p_user_id: string }
        Returns: {
          created: boolean
          status: string
        }[]
      }
      erase_user_application_data: {
        Args: { p_user_id: string }
        Returns: Json
      }
      external_api_take_rate_slot: {
        Args: { p_bucket: string; p_limit?: number; p_window_ms?: number }
        Returns: number
      }
      fail_analysis_job_atomic: {
        Args: { p_error: string; p_lease_token: string; p_run_id: string }
        Returns: {
          accepted: boolean
        }[]
      }
      fail_push_delivery_event: {
        Args: {
          p_delivery_state: Json
          p_error: string
          p_id: string
          p_lock_token: string
          p_retryable: boolean
        }
        Returns: boolean
      }
      finalize_analysis_draft_atomic: {
        Args: {
          p_draft_id: string
          p_idempotency_key: string
          p_owner_id: string
        }
        Returns: {
          reused: boolean
          run_id: string
        }[]
      }
      finalize_decision_selection_atomic: {
        Args: { p_owner_id: string; p_run_id: string }
        Returns: {
          accepted_count: number
          finalized: boolean
        }[]
      }
      get_due_clv_tracking_ids: {
        Args: { p_limit?: number; p_owner_id: string }
        Returns: {
          id: string
        }[]
      }
      get_five_dollar_model_history_rows: {
        Args: { p_lookback_days?: number; p_prediction_at: string }
        Returns: {
          raw_value: Json
        }[]
      }
      get_model_artifact_inventory: {
        Args: never
        Returns: {
          calibration_version: string
          data_status: string
          first_prediction_at: string
          inferred_family: string
          last_prediction_at: string
          market: string
          model_status: string
          model_version: string
          prediction_count: number
          registry_calibration_version: string
          registry_found: boolean
          registry_validation_status: string
        }[]
      }
      get_model_lab_events: {
        Args: { p_limit?: number; p_owner_id: string }
        Returns: {
          candidate_version: string
          created_at: string
          event_type: string
          id: string
          message: string
          model_version: string
          payload: Json
          read_at: string
          severity: string
          stage: string
          title: string
        }[]
      }
      get_owner_bankroll_metrics: {
        Args: { p_owner_id: string }
        Returns: {
          available_bankroll: number
          current_equity: number
          fractional_kelly: number
          initial_bankroll: number
          locked_stake: number
          max_stake_pct: number
          min_stake_brl: number
          settled_profit: number
        }[]
      }
      get_owner_home_metrics: {
        Args: { p_owner_id: string }
        Returns: {
          locked_stake: number
          open_bets_count: number
          proposed_count: number
          settled_profit: number
        }[]
      }
      get_owner_latest_proposed_run_id: {
        Args: { p_owner_id: string }
        Returns: string
      }
      get_owner_open_bets: {
        Args: { p_owner_id: string }
        Returns: {
          accepted_at: string | null
          bet_status: string
          closing_fetched_at: string | null
          closing_line: number | null
          closing_odd: number | null
          closing_source: string | null
          closing_stage: string | null
          clv_attempts: number
          clv_implied_delta: number | null
          clv_next_retry_at: string | null
          clv_pct: number | null
          clv_status: string | null
          competition: string | null
          created_at: string
          decision_edge: number | null
          decision_expected_value: number | null
          decision_odd: number | null
          decision_policy_version: string
          decision_quote_captured_at: string | null
          declined_at: string | null
          edge: number | null
          entry_odd: number
          execution_quote_captured_at: string | null
          execution_quote_source: string | null
          expected_value: number | null
          fair_odd: number | null
          id: string
          line_canonical: number | null
          market: string
          market_family: string
          market_label: string
          match_id: string | null
          match_label: string
          min_odd_target: number | null
          model_probability: number
          model_status: string
          model_version: string
          notes: string | null
          opening_line: number | null
          opening_odd: number | null
          participant: string | null
          prediction_id: string
          profit_brl: number | null
          profit_units: number | null
          result: string
          run_id: string
          selection_rank: number | null
          settled_at: string | null
          side: string | null
          stake_brl: number | null
          target_date: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "experimental_bet_tracking"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_owner_tracking_history: {
        Args: { p_limit?: number; p_owner_id: string }
        Returns: {
          accepted_at: string | null
          bet_status: string
          closing_fetched_at: string | null
          closing_line: number | null
          closing_odd: number | null
          closing_source: string | null
          closing_stage: string | null
          clv_attempts: number
          clv_implied_delta: number | null
          clv_next_retry_at: string | null
          clv_pct: number | null
          clv_status: string | null
          competition: string | null
          created_at: string
          decision_edge: number | null
          decision_expected_value: number | null
          decision_odd: number | null
          decision_policy_version: string
          decision_quote_captured_at: string | null
          declined_at: string | null
          edge: number | null
          entry_odd: number
          execution_quote_captured_at: string | null
          execution_quote_source: string | null
          expected_value: number | null
          fair_odd: number | null
          id: string
          line_canonical: number | null
          market: string
          market_family: string
          market_label: string
          match_id: string | null
          match_label: string
          min_odd_target: number | null
          model_probability: number
          model_status: string
          model_version: string
          notes: string | null
          opening_line: number | null
          opening_odd: number | null
          participant: string | null
          prediction_id: string
          profit_brl: number | null
          profit_units: number | null
          result: string
          run_id: string
          selection_rank: number | null
          settled_at: string | null
          side: string | null
          stake_brl: number | null
          target_date: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "experimental_bet_tracking"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_raw_observation_cache_rows: {
        Args: {
          p_cache_keys: string[]
          p_definition_version: string
          p_source: string
        }
        Returns: {
          cache_key: string
          fetched_at: string
          metric: string
          observed_at: string
          raw_value: Json
        }[]
      }
      get_scheduled_daily_analysis_config: {
        Args: never
        Returns: {
          enabled: boolean
          owner_id: string
          target_offset_days: number
        }[]
      }
      get_scheduled_daily_analysis_state: {
        Args: { p_owner_id: string; p_target_date: string }
        Returns: {
          job_status: string
          run_id: string
          run_status: string
        }[]
      }
      get_stage4_corners_validation_rows: {
        Args: never
        Returns: {
          away_corners: number
          away_team_id: number
          fixture_date: string
          fixture_id: number
          home_corners: number
          home_team_id: number
          league: string
        }[]
      }
      get_stage4_corners_validation_rows_page: {
        Args: {
          p_after_date?: string
          p_after_fixture_id?: number
          p_limit?: number
        }
        Returns: {
          away_corners: number
          away_team_id: number
          fixture_date: string
          fixture_id: number
          home_corners: number
          home_team_id: number
          league: string
        }[]
      }
      get_stage6_goals_validation_rows_page: {
        Args: {
          p_after_date?: string
          p_after_fixture_id?: number
          p_limit?: number
        }
        Returns: {
          away_goals: number
          away_team_id: number
          elo_away_rating_before: number
          elo_home_rating_before: number
          elo_model_version: string
          fixture_date: string
          fixture_id: number
          home_goals: number
          home_team_id: number
          league: string
        }[]
      }
      get_stage7_1x2_holdout_rows_page: {
        Args: {
          p_after_prediction_at?: string
          p_after_prediction_id?: string
          p_calibration_version: string
          p_limit?: number
        }
        Returns: {
          away_goals: number
          calibrated_probability: number
          fixture_date: string
          fixture_id: number
          home_goals: number
          league: string
          prediction_at: string
          prediction_id: string
          raw_probability: number
          side: string
        }[]
      }
      get_stage7_active_calibration: {
        Args: { p_market_family: string; p_model_version: string }
        Returns: {
          calibration_version: string
          fit_report: Json
          parameters: Json
          status: string
        }[]
      }
      get_stage9_1x2_holdout_rows_page: {
        Args: {
          p_after_prediction_at?: string
          p_after_prediction_id?: string
          p_limit?: number
        }
        Returns: {
          away_goals: number
          calibrated_probability: number
          fixture_date: string
          fixture_id: number
          home_goals: number
          league: string
          prediction_at: string
          prediction_id: string
          raw_probability: number
          side: string
        }[]
      }
      get_stage9_active_calibration: {
        Args: { p_market_family: string; p_model_version: string }
        Returns: {
          calibration_version: string
          fit_report: Json
          parameters: Json
          status: string
          validation_status: string
        }[]
      }
      heartbeat_analysis_job: {
        Args: { p_lease_token: string; p_run_id: string }
        Returns: boolean
      }
      is_approved_app_user: { Args: never; Returns: boolean }
      kick_analysis_worker: { Args: never; Returns: number }
      kick_external_api_maintenance: { Args: never; Returns: number }
      kick_external_api_maintenance_when_idle: { Args: never; Returns: Json }
      kick_push_delivery_dispatcher: { Args: never; Returns: number }
      kick_scheduled_daily_analysis: { Args: never; Returns: number }
      kick_stage4_corners_validation: {
        Args: never
        Returns: {
          job_id: string
          request_id: number
        }[]
      }
      kick_stage6_goals_validation: {
        Args: { p_market_family: string; p_model_version: string }
        Returns: {
          job_id: string
          request_id: number
        }[]
      }
      kick_stage7_1x2_calibration: {
        Args: never
        Returns: {
          job_id: string
          request_id: number
        }[]
      }
      kick_stage7_1x2_holdout: {
        Args: never
        Returns: {
          job_id: string
          request_id: number
        }[]
      }
      kick_stage7b_1x2_calibration: {
        Args: never
        Returns: {
          job_id: string
          request_id: number
        }[]
      }
      kick_stage7b_1x2_holdout: {
        Args: never
        Returns: {
          job_id: string
          request_id: number
        }[]
      }
      kick_stage7c_1x2_calibration: {
        Args: never
        Returns: {
          job_id: string
          request_id: number
        }[]
      }
      kick_stage7c_1x2_holdout: {
        Args: never
        Returns: {
          job_id: string
          request_id: number
        }[]
      }
      kick_stage8_1x2_error_audit: {
        Args: never
        Returns: {
          job_id: string
          request_id: number
        }[]
      }
      kick_stage9_1x2_calibration: {
        Args: never
        Returns: {
          job_id: string
          request_id: number
        }[]
      }
      kick_stage9_1x2_holdout: {
        Args: never
        Returns: {
          job_id: string
          request_id: number
        }[]
      }
      kick_stage9_daily_lab: { Args: never; Returns: string }
      mark_external_api_rate_limited: {
        Args: { p_provider: string; p_retry_after_seconds: number }
        Returns: undefined
      }
      mark_model_lab_events_read: {
        Args: { p_owner_id: string }
        Returns: number
      }
      next_decision_batch_atomic: {
        Args: { p_limit?: number; p_owner_id: string; p_run_id: string }
        Returns: {
          batch_no: number | null
          competition: string | null
          created_at: string
          edge: number | null
          entry_odd: number
          expected_value: number | null
          fair_odd: number | null
          id: string
          line_canonical: number | null
          market: string
          market_family: string
          market_label: string
          match_id: string | null
          match_label: string
          min_odd_target: number | null
          model_probability: number
          model_status: string
          model_version: string
          participant: string | null
          prediction_id: string
          queue_state: string
          rank_global: number
          run_id: string
          side: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "decision_opportunity_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      promote_stage9_1x2_if_holdout_passed: { Args: never; Returns: boolean }
      raw_observation_identity: {
        Args: {
          p_definition_version: string
          p_match_id: string
          p_metric: string
          p_observed_at: string
          p_raw_value: Json
          p_run_id: string
          p_source: string
        }
        Returns: string
      }
      reconcile_automation_runs: {
        Args: { p_timeout_minutes?: number }
        Returns: Json
      }
      reconcile_orphan_analysis_runs: {
        Args: { p_stale_minutes?: number }
        Returns: number
      }
      replace_decision_queue_atomic: {
        Args: { p_owner_id: string; p_rows: Json; p_run_id: string }
        Returns: number
      }
      replace_run_value_analysis_atomic: {
        Args: {
          p_evaluations: Json
          p_owner_id: string
          p_run_id: string
          p_selections: Json
          p_user_odds: Json
        }
        Returns: number
      }
      retry_analysis_job_atomic: {
        Args: { p_run_id: string; p_user_id: string }
        Returns: {
          retried: boolean
          status: string
        }[]
      }
      run_performance_retention_cleanup: { Args: never; Returns: Json }
      run_privacy_retention_cleanup: { Args: never; Returns: Json }
      settle_experimental_bet_atomic: {
        Args: { p_id: string; p_outcome: string }
        Returns: {
          profit_brl: number
          profit_units: number
        }[]
      }
      start_analysis_job_step_atomic: {
        Args: { p_lease_token: string; p_run_id: string; p_step: string }
        Returns: {
          accepted: boolean
        }[]
      }
      store_stage7_calibration_artifact: {
        Args: {
          p_calibration_version: string
          p_market_family: string
          p_model_version: string
          p_parameters: Json
          p_report: Json
          p_status: string
        }
        Returns: boolean
      }
      store_stage7b_calibration_artifact: {
        Args: {
          p_calibration_version: string
          p_market_family: string
          p_model_version: string
          p_parameters: Json
          p_report: Json
          p_status: string
        }
        Returns: boolean
      }
      store_stage7c_calibration_artifact: {
        Args: {
          p_calibration_version: string
          p_market_family: string
          p_model_version: string
          p_parameters: Json
          p_report: Json
          p_status: string
        }
        Returns: boolean
      }
      store_stage9_calibration_artifact: {
        Args: {
          p_calibration_version: string
          p_market_family: string
          p_model_version: string
          p_parameters: Json
          p_report: Json
          p_status: string
        }
        Returns: boolean
      }
      update_stage7_holdout_artifact: {
        Args: {
          p_calibration_version: string
          p_holdout_report: Json
          p_market_family: string
          p_model_version: string
          p_status: string
        }
        Returns: boolean
      }
      update_stage9_holdout_artifact: {
        Args: {
          p_calibration_version: string
          p_holdout_report: Json
          p_market_family: string
          p_model_version: string
          p_status: string
        }
        Returns: boolean
      }
      validate_external_api_maintenance_token: {
        Args: { p_token: string }
        Returns: boolean
      }
      validate_push_dispatch_token: {
        Args: { p_token: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
