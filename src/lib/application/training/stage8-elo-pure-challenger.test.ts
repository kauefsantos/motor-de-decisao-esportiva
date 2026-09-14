import { describe, expect, it } from "vitest";

import type { Stage6GoalRow } from "./goals-walk-forward";
import {
  STAGE8_ELO_PURE0_ADVANTAGE,
  STAGE8_ELO_PURE60_ADVANTAGE,
  buildStage8PureEloRatingsBefore,
  davidsonEloProbabilities,
  runStage8PureEloChallengers,
} from "./stage8-elo-pure-challenger";

function makeHistory(): Stage6GoalRow[] {
  const rows: Stage6GoalRow[] = [];
  const teams = ["A", "B", "C", "D"];
  let fixture = 1;
  for (let day = 0; day < 220; day += 1) {
    const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
    const homeTeamId = teams[day % teams.length] ?? "A";
    const awayTeamId = teams[(day + 1) % teams.length] ?? "B";
    rows.push({
      fixtureId: String(fixture++),
      date,
      league: "england-premier-league",
      homeTeamId,
      awayTeamId,
      homeGoals: day % 6 === 0 ? 1 : day % 5 === 0 ? 0 : 2,
      awayGoals: day % 6 === 0 ? 1 : day % 7 === 0 ? 2 : 1,
      eloHomeRatingBefore: 1500,
      eloAwayRatingBefore: 1500,
      eloModelVersion: "elo-v1-w020",
    });
  }
  return rows;
}

describe("Stage 8 pure Elo challengers", () => {
  it("tests both +60 and zero home advantage", () => {
    expect(STAGE8_ELO_PURE60_ADVANTAGE).toBe(60);
    expect(STAGE8_ELO_PURE0_ADVANTAGE).toBe(0);
  });

  it("produces proper Davidson 1X2 probabilities and +60 raises HOME for equal ratings", () => {
    const with60 = davidsonEloProbabilities(1500, 1500, 60, 0.7);
    const with0 = davidsonEloProbabilities(1500, 1500, 0, 0.7);

    expect(with60.home + with60.draw + with60.away).toBeCloseTo(1, 12);
    expect(with0.home + with0.draw + with0.away).toBeCloseTo(1, 12);
    expect(with60.home).toBeGreaterThan(with0.home);
    expect(with0.home).toBeCloseTo(with0.away, 12);
  });

  it("snapshots ratings before applying results from the same calendar day", () => {
    const rows: Stage6GoalRow[] = [
      {
        fixtureId: "1",
        date: "2026-01-01",
        league: "england-premier-league",
        homeTeamId: "A",
        awayTeamId: "B",
        homeGoals: 2,
        awayGoals: 0,
        eloHomeRatingBefore: 1500,
        eloAwayRatingBefore: 1500,
        eloModelVersion: "elo-v1-w020",
      },
      {
        fixtureId: "2",
        date: "2026-01-01",
        league: "england-premier-league",
        homeTeamId: "A",
        awayTeamId: "C",
        homeGoals: 1,
        awayGoals: 1,
        eloHomeRatingBefore: 1500,
        eloAwayRatingBefore: 1500,
        eloModelVersion: "elo-v1-w020",
      },
      {
        fixtureId: "3",
        date: "2026-01-02",
        league: "england-premier-league",
        homeTeamId: "A",
        awayTeamId: "B",
        homeGoals: 1,
        awayGoals: 0,
        eloHomeRatingBefore: 1500,
        eloAwayRatingBefore: 1500,
        eloModelVersion: "elo-v1-w020",
      },
    ];

    const before = buildStage8PureEloRatingsBefore(rows, 60);
    expect(before.get("england-premier-league::1")?.homeRating).toBe(1500);
    expect(before.get("england-premier-league::2")?.homeRating).toBe(1500);
    expect(before.get("england-premier-league::3")?.homeRating).not.toBe(1500);
  });

  it("compares pure +60 and pure zero against the incumbent on paired fixtures", () => {
    const report = runStage8PureEloChallengers(makeHistory(), "2026-06-01", "2026-08-01");

    expect(report.eloPure60.homeAdvantagePoints).toBe(60);
    expect(report.eloPure0.homeAdvantagePoints).toBe(0);
    expect(report.eloPure60.pairedSampleSize).toBeGreaterThan(0);
    expect(report.eloPure0.pairedSampleSize).toBe(report.eloPure60.pairedSampleSize);

    for (const variant of [report.eloPure60, report.eloPure0]) {
      expect(Number.isFinite(variant.incumbent.brier)).toBe(true);
      expect(Number.isFinite(variant.challenger.brier)).toBe(true);
      expect(Number.isFinite(variant.incumbent.logLoss)).toBe(true);
      expect(Number.isFinite(variant.challenger.logLoss)).toBe(true);
      expect(Number.isFinite(variant.averageDrawCoefficient)).toBe(true);
      expect(variant.homeCalibration.incumbent.length).toBeGreaterThan(0);
      expect(variant.homeCalibration.challenger.length).toBeGreaterThan(0);
      expect(variant.stabilityByMonth.length).toBeGreaterThan(0);
      expect(variant.stabilityByLeague).toHaveLength(1);
      expect(variant.stabilityByLeague[0]?.sampleSize).toBe(variant.pairedSampleSize);
      expect(variant.governance.benchmarkFrozen).toBe(true);
      expect(variant.governance.finalHoldoutUsedForFeatureSelection).toBe(false);
      expect(variant.governance.incumbentModified).toBe(false);
      expect(variant.governance.productionValidated).toBe(false);
      expect(variant.governance.realStakeUnlocked).toBe(false);
    }
  });
});
