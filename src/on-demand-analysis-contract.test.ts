import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("same-day on-demand analysis", () => {
  it("keeps the maintenance route token-protected and requires an explicit local cutoff", () => {
    const route = source("./routes/api.five-dollar-maintenance.ts");
    expect(route).toContain('const SAME_DAY_ACTION = "SAME_DAY_ANALYSIS"');
    expect(route).toContain("validate_external_api_maintenance_token");
    expect(route).toContain("HHMM_RE.test(afterLocalTime)");
    expect(route).toContain("runSameDayOnDemandAnalysis(afterLocalTime)");
  });

  it("uses today's Sao Paulo calendar date and only keeps eligible not-started fixtures after the cutoff", () => {
    const runner = source("./lib/on-demand-analysis.server.ts");
    expect(runner).toContain("const targetDate = saoPauloLocalDate(now)");
    expect(runner).toContain("saoPauloLocalDateTimeToIso(targetDate, cutoff)");
    expect(runner).toContain("selectScheduledFixtures(providerFixtures, allowedIds)");
    expect(runner).toContain("Date.parse(fixture.kickoff_at) >= cutoffMs");
  });

  it("preserves official fixture identity and skips RESOLVE before starting the normal worker", () => {
    const runner = source("./lib/on-demand-analysis.server.ts");
    expect(runner).toContain('"create_scheduled_analysis_run_atomic"');
    expect(runner).toContain('"enqueue_scheduled_analysis_job_atomic"');
    expect(runner).toContain('"kick_analysis_worker"');
    expect(runner).toContain("on_demand: true");
    expect(runner).toContain("target_offset_days: 0");
  });
});
