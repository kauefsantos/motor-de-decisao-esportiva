import { describe, expect, it } from "vitest";

import type { Stage6GoalRow } from "./goals-walk-forward";
import {
  STAGE8_HOME40_ADVANTAGE,
  buildStage8Home40RatingsBefore,
  runStage8Home40Challenger,
} from "./stage8-home40-challenger";

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
      homeGoals: day % 5 === 0 ? 3 : day % 3 === 0 ? 0 : 2,
      awayGoals: day % 7 === 0 ? 2 : day % 4 === 0 ? 0 : 1,
      eloHomeRatingBefore: 1450 + (day % 8) * 25,
      eloAwayRatingBefore: 1550 - (day % 8) * 20,
      eloModelVersion: "elo-v1-w020",
    });
  }
  return rows;
}

describe("Stage 8 HOME40 challenger", () => {
  it("uses a fixed 40-point Elo home advantage", () => {
    expect(STAGE8_HOME40_ADVANTAGE).toBe(40);
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

    const before = buildStage8Home40RatingsBefore(rows);
    expect(before.get("england-premier-league::1")?.homeRating).toBe(1500);
    expect(before.get("england-premier-league::2")?.homeRating).toBe(1500);
    expect(before.get("england-premier-league::3")?.homeRating).not.toBe(1500);
  });

  it("compares HOME40 against the incumbent on the exact same fixtures", () => {
    const report = runStage8Home40Challenger(makeHistory(), "2026-06-01", "2026-08-01");

    expect(report.homeAdvantagePoints).toBe(40);
    expect(report.pairedSampleSize).toBeGreaterThan(0);
    expect(Number.isFinite(report.incumbent.brier)).toBe(true);
    expect(Number.isFinite(report.challenger.brier)).toBe(true);
    expect(Number.isFinite(report.incumbent.logLoss)).toBe(true);
    expect(Number.isFinite(report.challenger.logLoss)).toBe(true);
    expect(report.homeCalibration.incumbent.length).toBeGreaterThan(0);
    expect(report.homeCalibration.challenger.length).toBeGreaterThan(0);
    expect(report.stabilityByMonth.length).toBeGreaterThan(0);
    expect(report.stabilityByMonth.every((row) => Number.isFinite(row.expectedCalibrationErrorDelta))).toBe(true);
    expect(report.stabilityByLeague).toHaveLength(1);
    expect(report.stabilityByLeague[0]?.league).toBe("england-premier-league");
    expect(report.stabilityByLeague[0]?.sampleSize).toBe(report.pairedSampleSize);
    expect(Number.isFinite(report.stabilityByLeague[0]?.brierDelta)).toBe(true);
    expect(Number.isFinite(report.stabilityByLeague[0]?.logLossDelta)).toBe(true);
    expect(Number.isFinite(report.stabilityByLeague[0]?.expectedCalibrationErrorDelta)).toBe(true);
    expect(Number.isFinite(report.stabilityByLeague[0]?.maxCalibrationGapDelta)).toBe(true);
    expect(report.governance.benchmarkFrozen).toBe(true);
    expect(report.governance.incumbentModified).toBe(false);
    expect(report.governance.productionValidated).toBe(false);
    expect(report.governance.realStakeUnlocked).toBe(false);
  });
});
