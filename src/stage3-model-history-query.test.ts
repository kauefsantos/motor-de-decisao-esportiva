import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Stage 3 bounded model history", () => {
  it("uses the server-side deduplicated history RPC instead of offset-paging a full year of raw JSON", () => {
    const raw = source("./lib/raw-observations.server.ts");
    const start = raw.indexOf("export async function loadFiveDollarRawValues");
    const end = raw.indexOf("export async function loadRunFiveDollarRawValues");
    const historyLoader = raw.slice(start, end);

    expect(historyLoader).toContain('db.rpc("get_five_dollar_model_history_rows"');
    expect(historyLoader).toContain("p_prediction_at: predictionAt");
    expect(historyLoader).toContain("p_lookback_days: lookbackDays");
    expect(historyLoader).not.toContain('.from("raw_observations")');
    expect(historyLoader).not.toContain(".range(");
  });

  it("preserves the 365-day point-in-time history contract used by prediction preparation", () => {
    const preparation = source("./lib/application/experimental-markets/prepare-run.server.ts");
    expect(preparation).toContain("loadFiveDollarRawValues(db, predictionAt, 365)");
  });

  it("limits the database helper to model inputs and keeps it server-only", () => {
    const migration = source("../supabase/migrations/20260913183000_stage3_model_history_query.sql");
    const lower = migration.toLowerCase();

    expect(migration).toContain("idx_raw_observations_model_history_latest");
    expect(migration).toContain("get_five_dollar_model_history_rows");
    expect(migration).toContain("r.observed_at < p_prediction_at");
    expect(migration).toContain("HOME:goals_for");
    expect(migration).toContain("HOME:corners_taken_for");
    expect(migration).toContain("HOME:cards_yellow_raw");
    expect(lower).not.toContain("research_attacks_for");
    expect(migration).toContain("revoke all on function public.get_five_dollar_model_history_rows(timestamptz,integer) from public,anon,authenticated");
    expect(migration).toContain("grant execute on function public.get_five_dollar_model_history_rows(timestamptz,integer) to service_role");
  });
});
