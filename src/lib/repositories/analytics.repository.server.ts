import type { AdminDb } from "../admin-db";
import type { BankrollConfig, TrackingRow } from "../domain/analytics";
import { callRuntimeRpc } from "./runtime-rpc.server";

export async function loadAnalyticsConfig(db: AdminDb, userId: string) {
  const { data, error } = await db
    .from("experimental_bankroll_config")
    .select("id,start_date,initial_bankroll,max_stake_pct,fractional_kelly")
    .eq("id", "main")
    .eq("owner_id", userId)
    .single();
  return { data: data as BankrollConfig | null, error };
}

export async function loadTrackingHistory(db: AdminDb, userId: string, limit = 5000) {
  const result = await callRuntimeRpc<TrackingRow[]>(db, "get_owner_tracking_history", {
    p_owner_id: userId,
    p_limit: limit,
  });
  return { data: result.data ?? [], error: result.error };
}
