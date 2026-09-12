import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260912150000_performance_scalability_hardening.sql");
const home = read("src/lib/home-summary.functions.ts");
const root = read("src/routes/__root.tsx");
const vite = read("vite.config.ts");
const ci = read(".github/workflows/ci.yml");
const vitals = read("src/components/WebVitalsReporter.tsx");

describe("performance and scalability contracts", () => {
  it("indexes run-scoped hot paths", () => {
    expect(migration).toContain("idx_model_predictions_run_id");
    expect(migration).toContain("idx_normalized_match_stats_run_id");
    expect(migration).toContain("idx_source_fetches_run_fetched_at");
  });

  it("indexes raw observation cache lookup and run/date access", () => {
    expect(migration).toContain("idx_raw_observations_cache_key");
    expect(migration).toContain("idx_raw_observations_run_observed_at");
  });

  it("bounds operational history growth", () => {
    expect(migration).toContain("interval '90 days'");
    expect(migration).toContain("performance-retention-daily");
  });

  it("moves home aggregation to a server-only database aggregate", () => {
    expect(home).toContain('db.rpc("get_owner_home_metrics"');
    expect(home).not.toContain('select("id").eq("owner_id"');
  });

  it("prioritizes user analysis over heavy background jobs", () => {
    expect(migration).toContain("elo_sync_next_target_when_idle");
    expect(migration).toContain("kick_external_api_maintenance_when_idle");
    expect(migration).toContain("status in ('QUEUED','RUNNING')");
  });

  it("collects authenticated real-user Core Web Vitals", () => {
    expect(root).toContain("<WebVitalsReporter />");
    expect(vitals).toContain('observe("largest-contentful-paint"');
    expect(vitals).toContain('observe("layout-shift"');
    expect(vitals).toContain('observe("event"');
  });

  it("keeps Web Vitals bounded and private", () => {
    expect(migration).toContain("performance_vitals");
    expect(migration).toContain("interval '30 days'");
    expect(migration).toContain("revoke all on public.performance_vitals from public, anon, authenticated");
  });

  it("splits major vendor groups", () => {
    expect(vite).toContain('return "vendor-react"');
    expect(vite).toContain('return "vendor-tanstack"');
    expect(vite).toContain('return "vendor-supabase"');
  });

  it("enforces bundle and load budgets in CI", () => {
    expect(ci).toContain("Client bundle performance budget");
    expect(ci).toContain("Concurrent HTTP load smoke");
  });

  it("reduces requested font variants without changing font families", () => {
    expect(root).toContain("IBM+Plex+Mono");
    expect(root).toContain("IBM+Plex+Sans");
    expect(root).not.toContain("Mono:wght@400;500;600");
  });
});