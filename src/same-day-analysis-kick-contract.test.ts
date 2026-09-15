import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("same-day analysis kick migration", () => {
  it("keeps the internal trigger service-role only and forwards the local cutoff", () => {
    const migration = source("../supabase/migrations/20260915144500_same_day_analysis_kick.sql");

    expect(migration).toContain("create or replace function public.kick_same_day_analysis");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path to ''");
    expect(migration).toContain("'SAME_DAY_ANALYSIS'");
    expect(migration).toContain("'afterLocalTime', p_after_local_time");
    expect(migration).toContain("revoke all on function public.kick_same_day_analysis(text) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.kick_same_day_analysis(text) to service_role");
  });
});
