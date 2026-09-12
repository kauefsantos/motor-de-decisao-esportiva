import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/database.types";

type DecisionOpportunityQueueTable = {
  Row: {
    id: string;
    run_id: string;
    match_id: string | null;
    prediction_id: string;
    rank_global: number;
    batch_no: number | null;
    queue_state: string;
    match_label: string;
    competition: string | null;
    market_family: string;
    market: string;
    market_label: string;
    participant: string | null;
    side: string | null;
    line_canonical: number | null;
    model_version: string;
    model_status: string;
    model_probability: number;
    fair_odd: number | null;
    entry_odd: number;
    min_odd_target: number | null;
    edge: number | null;
    expected_value: number | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    run_id: string;
    match_id?: string | null;
    prediction_id: string;
    rank_global: number;
    batch_no?: number | null;
    queue_state?: string;
    match_label: string;
    competition?: string | null;
    market_family: string;
    market: string;
    market_label: string;
    participant?: string | null;
    side?: string | null;
    line_canonical?: number | null;
    model_version: string;
    model_status: string;
    model_probability: number;
    fair_odd?: number | null;
    entry_odd: number;
    min_odd_target?: number | null;
    edge?: number | null;
    expected_value?: number | null;
    created_at?: string;
    updated_at?: string;
  };
  Update: Partial<DecisionOpportunityQueueTable["Insert"]>;
  Relationships: [
    {
      foreignKeyName: "decision_opportunity_queue_run_id_fkey";
      columns: ["run_id"];
      isOneToOne: false;
      referencedRelation: "analysis_runs";
      referencedColumns: ["id"];
    },
    {
      foreignKeyName: "decision_opportunity_queue_match_id_fkey";
      columns: ["match_id"];
      isOneToOne: false;
      referencedRelation: "matches";
      referencedColumns: ["id"];
    },
  ];
};

/**
 * Runtime additions that already exist in Lovable Cloud but have not yet landed
 * in the generated schema snapshot. Keep this extension typed and server-only.
 */
export type RuntimeDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      decision_opportunity_queue: DecisionOpportunityQueueTable;
    };
  };
};

export async function adminDb(): Promise<SupabaseClient<RuntimeDatabase>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient<RuntimeDatabase>;
}

export type AdminDb = Awaited<ReturnType<typeof adminDb>>;
