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
      analysis_runs: {
        Row: {
          candidates_blocked: number
          candidates_published: number
          created_at: string
          current_step: string | null
          id: string
          matches_failed: number
          matches_resolved: number
          matches_total: number
          notes: Json
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
          matches_failed?: number
          matches_resolved?: number
          matches_total?: number
          notes?: Json
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
          matches_failed?: number
          matches_resolved?: number
          matches_total?: number
          notes?: Json
          selections_count?: number
          status?: string
          target_date?: string | null
          updated_at?: string
        }
        Relationships: []
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
      experimental_bankroll_config: {
        Row: {
          created_at: string
          fractional_kelly: number
          id: string
          initial_bankroll: number
          max_stake_pct: number
          min_stake_brl: number
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
          start_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      experimental_bet_tracking: {
        Row: {
          accepted_at: string | null
          bet_status: string
          closing_odd: number | null
          competition: string | null
          created_at: string
          declined_at: string | null
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
          notes: string | null
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
          closing_odd?: number | null
          competition?: string | null
          created_at?: string
          declined_at?: string | null
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
          notes?: string | null
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
          closing_odd?: number | null
          competition?: string | null
          created_at?: string
          declined_at?: string | null
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
          notes?: string | null
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
        ]
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
            foreignKeyName: "final_selections_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
        ]
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
        ]
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
      raw_observations: {
        Row: {
          definition_version: string | null
          fetched_at: string
          id: string
          match_id: string | null
          metric: string
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
        ]
      }
      source_definitions: {
        Row: {
          configured: boolean
          created_at: string
          definition_version: string
          id: string
          metric_definitions: Json
          notes: string | null
          source: string
        }
        Insert: {
          configured?: boolean
          created_at?: string
          definition_version: string
          id?: string
          metric_definitions?: Json
          notes?: string | null
          source: string
        }
        Update: {
          configured?: boolean
          created_at?: string
          definition_version?: string
          id?: string
          metric_definitions?: Json
          notes?: string | null
          source?: string
        }
        Relationships: []
      }
      source_fetches: {
        Row: {
          attempt: number
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
