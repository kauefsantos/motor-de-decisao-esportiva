import { describe, expect, it } from "vitest";

import { runStage8OneXTwoErrorAudit } from "./stage8-1x2-error-audit";
import type { Stage6GoalRow } from "./goals-walk-forward";

function makeHistory(): Stage6GoalRow[] {
  const rows: Stage6GoalRow[] = [];
  const teams = ["A", "B", "C", "D"];
  let fixture = 1;
  for (let day = 0; day < 210; day += 1) {
    const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
    const homeTeamId = teams[day % teams.length] ?? "A";
    const awayTeamId = teams[(day + 1) % teams.length] ?? "B";
    const homeGoals = day % 5 === 0 ? 3 : day % 3 === 0 ? 0 : 2;
    const awayGoals = day % 7 === 0 ? 2 : day % 4 === 0 ? 0 : 1;
    rows.push({
      fixtureId: String(fixture++),
      date,
      league: "england-premier-league",
      homeTeamId,
      awayTeamId,
      homeGoals,
      awayGoals,
      eloHomeRatingBefore: 1450 + (day % 8) * 25,
      eloAwayRatingBefore: 1550 - (day % 8) * 20,
      eloModelVersion: "elo-v1-w020",
    });
  }
  return rows;
}

describe("Stage 8 1X2 deep error audit", () => {
  it("audits the frozen retrospective benchmark without promotion or gate relaxation", () => {
    const report = runStage8OneXTwoErrorAudit(makeHistory());

    expect(report.protocolVersion).toBe("stage8-1x2-error-audit-v1");
    expect(report.targetArtifact).toBe("goals-baseline-v2-recency+elo-v1-w020");
    expect(report.readinessStatus).toBe("AUDIT_COMPLETE_NO_PROMOTION");
    expect(report.eligiblePredictions).toBeGreaterThan(0);
    expect(report.governance.benchmarkFrozen).toBe(true);
    expect(report.governance.formulaChanged).toBe(false);
    expect(report.governance.calibrationChanged).toBe(false);
    expect(report.governance.calibrationTolerance).toBe(0.1);
    expect(report.governance.toleranceRelaxed).toBe(false);
    expect(report.governance.promotionAttempted).toBe(false);
    expect(report.governance.productionValidated).toBe(false);
    expect(report.governance.realStakeUnlocked).toBe(false);
    expect(report.governance.holdoutStarted).toBe(false);
  });

  it("segments the error drivers required for challenger evidence", () => {
    const report = runStage8OneXTwoErrorAudit(makeHistory());

    expect(Object.keys(report.dimensions)).toEqual(expect.arrayContaining([
      "league",
      "month",
      "favoriteSide",
      "favoriteProbability",
      "eloDifference",
      "homeElo",
      "awayElo",
      "lambdaTotal",
      "lambdaDifference",
      "leagueHomeGoalEdge",
      "goalSampleSize",
      "trainingMatches",
      "recentTrainingShare120",
      "homeAttackFactor",
      "homeDefenseFactor",
      "awayAttackFactor",
      "awayDefenseFactor",
    ]));
    expect(report.eligiblePredictions).toBeGreaterThan(0);
    expect(report.overall.homeCalibration.length).toBeGreaterThan(0);
    expect(report.overall.officialWorstGap).not.toBeNull();
  });

  it("compares Elo against the same no-Elo forecast instead of a different dataset", () => {
    const report = runStage8OneXTwoErrorAudit(makeHistory());

    expect(report.eligiblePredictions).toBeGreaterThan(0);
    expect(report.overall.eloBrierDelta).toBe(
      report.overall.model.brier - report.overall.noElo.brier,
    );
    expect(report.overall.eloLogLossDelta).toBe(
      report.overall.model.logLoss - report.overall.noElo.logLoss,
    );
  });
});