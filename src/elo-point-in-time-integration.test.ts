import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("hierarchical Elo point-in-time contract", () => {
  it("falls back from the current snapshot to the interleague history ledger", () => {
    const feature = source("./lib/elo-feature.server.ts");

    expect(feature).toContain('from("elo_league_ratings")');
    expect(feature).toContain('from("elo_league_fixture_history")');
    expect(feature).toContain('lt("kickoff_at", predictionAt)');
    expect(feature).toContain("return leagueRatingAtHistory(leagueId, predictionAt)");
  });

  it("reconstructs the latest deterministic league rating before prediction_at", () => {
    const feature = source("./lib/elo-feature.server.ts");

    expect(feature).toContain('order("kickoff_at", { ascending: false })');
    expect(feature).toContain('order("competition_id", { ascending: false })');
    expect(feature).toContain('order("fixture_id", { ascending: false })');
    expect(feature).toContain('{ count: "exact", head: true }');
    expect(feature).toContain("evidenceMatches >= MIN_LEAGUE_EVIDENCE_MATCHES");
  });

  it("replays the structural hierarchy constraints for historical snapshots", () => {
    const feature = source("./lib/elo-feature.server.ts");

    expect(feature).toContain("parent.rating - 70");
    expect(feature).toContain("Math.min(...bigFiveRatings) - 25");
    expect(feature).toContain('base.config.focus_role === "CORE"');
  });

  it("uses point-in-time league ratings in the hierarchical betting adjustment", () => {
    const feature = source("./lib/elo-feature.server.ts");
    const hierarchicalBranch = feature.indexOf('scope = "CROSS_LEAGUE_HIERARCHICAL"');
    const homeLookup = feature.indexOf("leagueRatingAt(home.leagueId, input.predictionAt)", hierarchicalBranch);
    const awayLookup = feature.indexOf("leagueRatingAt(away.leagueId, input.predictionAt)", hierarchicalBranch);

    expect(hierarchicalBranch).toBeGreaterThanOrEqual(0);
    expect(homeLookup).toBeGreaterThan(hierarchicalBranch);
    expect(awayLookup).toBeGreaterThan(homeLookup);
  });
});
