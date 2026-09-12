// Canonical database type facade for the Lovable Cloud runtime schema.
// `types.ts` remains the generated schema snapshot; runtime code imports Database from this file.
// Schema additions newer than the generated snapshot are centralized here until the snapshot is regenerated.

import type { Database as GeneratedDatabase, Json } from './types';

type BaseTables = GeneratedDatabase['public']['Tables'];
type BaseFunctions = GeneratedDatabase['public']['Functions'];

type AnalysisRunsTable = {
  Row: BaseTables['analysis_runs']['Row'] & { owner_id: string };
  Insert: BaseTables['analysis_runs']['Insert'] & { owner_id?: string };
  Update: BaseTables['analysis_runs']['Update'] & { owner_id?: string };
  Relationships: BaseTables['analysis_runs']['Relationships'];
};

type RawObservationsTable = {
  Row: BaseTables['raw_observations']['Row'] & { observation_key: string };
  Insert: BaseTables['raw_observations']['Insert'] & { observation_key?: string };
  Update: BaseTables['raw_observations']['Update'] & { observation_key?: string };
  Relationships: BaseTables['raw_observations']['Relationships'];
};

type ExperimentalBankrollConfigTable = {
  Row: BaseTables['experimental_bankroll_config']['Row'] & { owner_id: string | null };
  Insert: BaseTables['experimental_bankroll_config']['Insert'] & { owner_id?: string | null };
  Update: BaseTables['experimental_bankroll_config']['Update'] & { owner_id?: string | null };
  Relationships: BaseTables['experimental_bankroll_config']['Relationships'];
};

type ExperimentalBetTrackingTable = {
  Row: BaseTables['experimental_bet_tracking']['Row'] & {
    opening_odd: number | null;
    opening_line: number | null;
    closing_line: number | null;
    closing_stage: string | null;
    clv_pct: number | null;
    clv_implied_delta: number | null;
    clv_status: string | null;
    closing_fetched_at: string | null;
    closing_source: string | null;
  };
  Insert: BaseTables['experimental_bet_tracking']['Insert'] & {
    opening_odd?: number | null;
    opening_line?: number | null;
    closing_line?: number | null;
    closing_stage?: string | null;
    clv_pct?: number | null;
    clv_implied_delta?: number | null;
    clv_status?: string | null;
    closing_fetched_at?: string | null;
    closing_source?: string | null;
  };
  Update: BaseTables['experimental_bet_tracking']['Update'] & {
    opening_odd?: number | null;
    opening_line?: number | null;
    closing_line?: number | null;
    closing_stage?: string | null;
    clv_pct?: number | null;
    clv_implied_delta?: number | null;
    clv_status?: string | null;
    closing_fetched_at?: string | null;
    closing_source?: string | null;
  };
  Relationships: BaseTables['experimental_bet_tracking']['Relationships'];
};

type ExperimentalValueEvaluationInsert = {
  id?: string;
  run_id: string;
  prediction_id: string;
  match_id?: string | null;
  market: string;
  market_label: string;
  participant?: string | null;
  side?: string | null;
  line_canonical?: number | null;
  bookmaker?: string;
  price_source?: string;
  odd: number;
  model_probability: number;
  decision_probability?: number | null;
  fair_odd?: number | null;
  min_odd_target?: number | null;
  edge?: number | null;
  expected_value?: number | null;
  probability_status: string;
  value_status: string;
  execution_status: string;
  rejection_reason?: string | null;
  selected?: boolean;
  model_version?: string | null;
  model_status: string;
  production_status: string;
  market_family: string;
  evaluation_fingerprint: string;
  evaluated_at?: string;
};

type ExperimentalValueEvaluationUpdate = {
  id?: string;
  run_id?: string;
  prediction_id?: string;
  match_id?: string | null;
  market?: string;
  market_label?: string;
  participant?: string | null;
  side?: string | null;
  line_canonical?: number | null;
  bookmaker?: string;
  price_source?: string;
  odd?: number;
  model_probability?: number;
  decision_probability?: number | null;
  fair_odd?: number | null;
  min_odd_target?: number | null;
  edge?: number | null;
  expected_value?: number | null;
  probability_status?: string;
  value_status?: string;
  execution_status?: string;
  rejection_reason?: string | null;
  selected?: boolean;
  model_version?: string | null;
  model_status?: string;
  production_status?: string;
  market_family?: string;
  evaluation_fingerprint?: string;
  evaluated_at?: string;
};

type FiveDollarLeaguePriorInsert = {
  id?: string;
  league_id: number;
  prior_type: string;
  season?: string | null;
  source_kind?: string | null;
  round_label?: string | null;
  team_id: number;
  team_name: string;
  played?: number | null;
  total_for?: number | null;
  total_against?: number | null;
  average_for?: number | null;
  average_against?: number | null;
  raw?: Json;
  snapshot_date: string;
  snapshot_at?: string;
  created_at?: string;
  updated_at?: string;
};

type FiveDollarLeaguePriorUpdate = {
  id?: string;
  league_id?: number;
  prior_type?: string;
  season?: string | null;
  source_kind?: string | null;
  round_label?: string | null;
  team_id?: number;
  team_name?: string;
  played?: number | null;
  total_for?: number | null;
  total_against?: number | null;
  average_for?: number | null;
  average_against?: number | null;
  raw?: Json;
  snapshot_date?: string;
  snapshot_at?: string;
  created_at?: string;
  updated_at?: string;
};

export type Database = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<GeneratedDatabase['public'], 'Tables' | 'Functions'> & {
    Tables: Omit<
      BaseTables,
      'analysis_runs' | 'raw_observations' | 'experimental_bankroll_config' | 'experimental_bet_tracking'
    > & {
      analysis_runs: AnalysisRunsTable;
      raw_observations: RawObservationsTable;
      experimental_bankroll_config: ExperimentalBankrollConfigTable;
      experimental_bet_tracking: ExperimentalBetTrackingTable;

      analysis_jobs: {
        Row: {
          run_id: string;
          user_id: string;
          status: string;
          current_step: string | null;
          completed_steps: string[];
          attempts: number;
          locked_at: string | null;
          completed_at: string | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
          dispatch_token: string;
        };
        Insert: {
          run_id: string;
          user_id: string;
          status?: string;
          current_step?: string | null;
          completed_steps?: string[];
          attempts?: number;
          locked_at?: string | null;
          completed_at?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
          dispatch_token?: string;
        };
        Update: {
          run_id?: string;
          user_id?: string;
          status?: string;
          current_step?: string | null;
          completed_steps?: string[];
          attempts?: number;
          locked_at?: string | null;
          completed_at?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
          dispatch_token?: string;
        };
        Relationships: [{
          foreignKeyName: 'analysis_jobs_run_id_fkey';
          columns: ['run_id'];
          isOneToOne: true;
          referencedRelation: 'analysis_runs';
          referencedColumns: ['id'];
        }];
      };

      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          endpoint?: string;
          p256dh?: string;
          auth?: string;
          user_agent?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      experimental_analysis_results: {
        Row: { run_id: string; result_payload: Json; analyzed_at: string; updated_at: string };
        Insert: { run_id: string; result_payload: Json; analyzed_at?: string; updated_at?: string };
        Update: { run_id?: string; result_payload?: Json; analyzed_at?: string; updated_at?: string };
        Relationships: [{
          foreignKeyName: 'experimental_analysis_results_run_id_fkey';
          columns: ['run_id'];
          isOneToOne: true;
          referencedRelation: 'analysis_runs';
          referencedColumns: ['id'];
        }];
      };

      experimental_value_evaluations: {
        Row: {
          id: string;
          run_id: string;
          prediction_id: string;
          match_id: string | null;
          market: string;
          market_label: string;
          participant: string | null;
          side: string | null;
          line_canonical: number | null;
          bookmaker: string;
          price_source: string;
          odd: number;
          model_probability: number;
          decision_probability: number | null;
          fair_odd: number | null;
          min_odd_target: number | null;
          edge: number | null;
          expected_value: number | null;
          probability_status: string;
          value_status: string;
          execution_status: string;
          rejection_reason: string | null;
          selected: boolean;
          model_version: string | null;
          model_status: string;
          production_status: string;
          market_family: string;
          evaluation_fingerprint: string;
          evaluated_at: string;
        };
        Insert: ExperimentalValueEvaluationInsert;
        Update: ExperimentalValueEvaluationUpdate;
        Relationships: [
          {
            foreignKeyName: 'experimental_value_evaluations_match_id_fkey';
            columns: ['match_id'];
            isOneToOne: false;
            referencedRelation: 'matches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'experimental_value_evaluations_run_id_fkey';
            columns: ['run_id'];
            isOneToOne: false;
            referencedRelation: 'analysis_runs';
            referencedColumns: ['id'];
          },
        ];
      };

      external_api_rate_limit_state: {
        Row: { bucket: string; window_started_at: string; request_count: number; updated_at: string };
        Insert: { bucket: string; window_started_at: string; request_count?: number; updated_at?: string };
        Update: { bucket?: string; window_started_at?: string; request_count?: number; updated_at?: string };
        Relationships: [];
      };

      five_dollar_league_priors: {
        Row: {
          id: string;
          league_id: number;
          prior_type: string;
          season: string | null;
          source_kind: string | null;
          round_label: string | null;
          team_id: number;
          team_name: string;
          played: number | null;
          total_for: number | null;
          total_against: number | null;
          average_for: number | null;
          average_against: number | null;
          raw: Json;
          snapshot_date: string;
          snapshot_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: FiveDollarLeaguePriorInsert;
        Update: FiveDollarLeaguePriorUpdate;
        Relationships: [];
      };

      app_schema_releases: {
        Row: {
          version: string;
          migration_name: string;
          git_sha: string | null;
          checksum: string | null;
          applied_at: string;
          notes: string | null;
        };
        Insert: {
          version: string;
          migration_name: string;
          git_sha?: string | null;
          checksum?: string | null;
          applied_at?: string;
          notes?: string | null;
        };
        Update: {
          version?: string;
          migration_name?: string;
          git_sha?: string | null;
          checksum?: string | null;
          applied_at?: string;
          notes?: string | null;
        };
        Relationships: [];
      };
    };
    Functions: BaseFunctions & {
      claim_analysis_job: {
        Args: { p_run_id: string; p_dispatch_token: string };
        Returns: Array<{ run_id: string; user_id: string; completed_steps: string[]; attempts: number }>;
      };
      kick_analysis_worker: { Args: never; Returns: number | null };
      raw_observation_identity: {
        Args: {
          p_run_id: string;
          p_match_id: string | null;
          p_source: string;
          p_metric: string;
          p_raw_value: Json | null;
          p_observed_at: string | null;
          p_definition_version: string | null;
        };
        Returns: string;
      };
    };
  };
};
