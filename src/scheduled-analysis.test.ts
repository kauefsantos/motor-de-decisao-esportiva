import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { FiveDollarFixture } from "./lib/adapters/five_dollar.parse";
import { scheduledTargetDate, selectScheduledFixtures } from "./lib/scheduled-analysis";

function fixture(overrides: Partial<FiveDollarFixture> = {}): FiveDollarFixture {
  return {
    eventId: 100,
    homeName: "Palmeiras",
    awayName: "Cruzeiro",
    homeTeamId: 10,
    awayTeamId: 20,
    tournament: "Brazil Serie A",
    category: null,
    season: null,
    startTimestamp: 1_789_500_000,
    statusType: "notstarted",
    homeScore: null,
    awayScore: null,
    leagueId: 3118717965,
    cornersHome: null,
    cornersAway: null,
    yellowHome: null,
    yellowAway: null,
    redHome: null,
    redAway: null,
    kickoffIso: "2026-09-15T23:30:00.000Z",
    embeddedStatistics: null,
    embeddedEvents: [],
    ...overrides,
  };
}

describe("scheduled D+2 analysis", () => {
  it("calculates D+2 from the Sao Paulo calendar day instead of UTC", () => {
    expect(scheduledTargetDate(new Date("2026-09-13T02:30:00.000Z"), 2)).toBe("2026-09-14");
    expect(scheduledTargetDate(new Date("2026-09-13T15:45:00.000Z"), 2)).toBe("2026-09-15");
  });

  it("selects only scheduled fixtures from approved competitions with complete provider identities", () => {
    const selected = selectScheduledFixtures([
      fixture(),
      fixture({ eventId: 100 }),
      fixture({ eventId: 101, leagueId: 999 }),
      fixture({ eventId: 102, homeTeamId: null }),
      fixture({ eventId: 103, statusType: "finished" }),
      fixture({ eventId: 104, kickoffIso: "2026-09-15T20:00:00.000Z", startTimestamp: 1_789_487_200 }),
    ], new Set([3118717965]));

    expect(selected.map((row) => row.event_id)).toEqual([104, 100]);
    expect(selected[0]).toMatchObject({
      home_team_id: 10,
      away_team_id: 20,
      league_id: 3118717965,
      competition: "Brazil Serie A",
    });
  });

  it("keeps the automated path id-first and resumes with the existing worker/push flow", () => {
    const migration = readFileSync(
      new URL("../supabase/migrations/20260912230000_scheduled_d2_analysis.sql", import.meta.url),
      "utf8",
    );
    const route = readFileSync(new URL("./routes/api.five-dollar-maintenance.ts", import.meta.url), "utf8");
    const server = readFileSync(new URL("./lib/scheduled-analysis.server.ts", import.meta.url), "utf8");
    const worker = readFileSync(new URL("./routes/api.analysis-worker.ts", import.meta.url), "utf8");
    const serviceWorker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

    expect(migration).toContain("RESOLVED_FIVE_DOLLAR");
    expect(migration).toContain("array['RESOLVE']::text[]");
    expect(migration).toContain("five_dollar_fixture");
    expect(migration).toContain("five_dollar_team_home");
    expect(migration).toContain("five_dollar_team_away");
    expect(migration).toContain("five_dollar_league");
    expect(migration).toContain("America/Sao_Paulo");
    expect(migration).toContain("'12:45','12:50','12:55','13:00'");
    expect(route).toContain('DAILY_D2_ACTION = "DAILY_D2_ANALYSIS"');
    expect(server).toContain('db.from("elo_target_leagues")');
    expect(server).toContain('db.from("elo_cross_competitions")');
    expect(server).toContain('"enqueue_scheduled_analysis_job_atomic"');
    expect(server).toContain('"kick_analysis_worker"');
    expect(worker).toContain('"enqueue_push_delivery_event"');
    expect(worker).toContain('"ANALYSIS_READY"');
    expect(serviceWorker).toContain("MANUAL_TARGET_TTL_MS");
    expect(serviceWorker).toContain('return fresh && typeof data?.url === "string"');
  });
});
