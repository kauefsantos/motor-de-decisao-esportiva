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
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
