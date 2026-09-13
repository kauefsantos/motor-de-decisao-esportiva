import { describe, expect, it } from "vitest";

import {
  STAGE4_CORNERS_TARGET_ARTIFACT,
  buildCornersWalkForwardPredictions,
  evaluateCornersWalkForward,
  type Stage4CornerRow,
} from "./corners-walk-forward";

function row(input: {
  fixtureId: string;
  date: string;
  homeCorners: number;
  awayCorners: number;
  league?: string;
}): Stage4CornerRow {
  return {
    fixtureId: input.fixtureId,
    date: input.date,
    league: input.league ?? "test-league",
    homeTeam: "100",
    awayTeam: "200",
    homeCorners: input.homeCorners,
    awayCorners: input.awayCorners,
  };
}

function dateAt(index: number): string {
  return new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
}

describe("Stage 4 corners walk-forward", () => {
  it("excludes every fixture from the target calendar date from training", () => {
    const rows = [
      row({ fixtureId: "1", date: "2026-01-01", homeCorners: 4, awayCorners: 4 }),
      row({ fixtureId: "2", date: "2026-01-02", homeCorners: 5, awayCorners: 4 }),
      row({ fixtureId: "3", date: "2026-01-03", homeCorners: 6, awayCorners: 4 }),
      row({ fixtureId: "4a", date: "2026-01-04", homeCorners: 7, awayCorners: 4 }),
      row({ fixtureId: "4b", date: "2026-01-04", homeCorners: 8, awayCorners: 4 }),
    ];

    const { predictions } = buildCornersWalkForwardPredictions(rows);
    const dayFour = predictions.filter((prediction) => prediction.date === "2026-01-04");
    expect(dayFour).toHaveLength(2);
    expect(dayFour.every((prediction) => prediction.trainingMatches === 3)).toBe(true);
  });

  it("does not let a future outcome change an earlier prediction", () => {
    const rows = Array.from({ length: 42 }, (_, index) =>
      row({
        fixtureId: String(index + 1),
        date: dateAt(index),
        homeCorners: index % 2 === 0 ? 2 : 10,
        awayCorners: index % 2 === 0 ? 2 : 9,
      }),
    );
    const original = buildCornersWalkForwardPredictions(rows).predictions;
    const mutated = rows.map((entry, index) =>
      index === rows.length - 1 ? { ...entry, homeCorners: 60, awayCorners: 60 } : entry,
    );
    const afterMutation = buildCornersWalkForwardPredictions(mutated).predictions;
    const fixtureBeforeFuture = String(rows.length - 1);
    expect(afterMutation.find((prediction) => prediction.fixtureId === fixtureBeforeFuture)).toEqual(
      original.find((prediction) => prediction.fixtureId === fixtureBeforeFuture),
    );
  });

  it("evaluates the exact composed NB2 artifact without promoting it", () => {
    const rows = Array.from({ length: 120 }, (_, index) =>
      row({
        fixtureId: String(index + 1),
        date: dateAt(index),
        homeCorners: index % 3 === 0 ? 15 : index % 3 === 1 ? 1 : 5,
        awayCorners: index % 3 === 0 ? 12 : index % 3 === 1 ? 1 : 4,
      }),
    );
    const report = evaluateCornersWalkForward(rows);
    expect(report.targetArtifact).toBe(STAGE4_CORNERS_TARGET_ARTIFACT);
    expect(report.nb2Predictions).toBeGreaterThan(0);
    expect(report.eligiblePredictions).toBeGreaterThan(report.nb2Predictions);
    expect(["INSUFFICIENT_OOS_DATA", "VALIDATION_FAILED", "READY_FOR_CALIBRATION"]).toContain(report.readinessStatus);
    expect(JSON.stringify(report)).not.toContain("PRODUCTION_VALIDATED");
  });
});
