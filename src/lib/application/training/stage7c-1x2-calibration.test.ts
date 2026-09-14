import { describe, expect, it } from "vitest";

import {
  STAGE7C_1X2_CALIBRATION_VERSION,
  STAGE7C_1X2_TARGET_MODEL,
  STAGE7C_MIN_PROSPECTIVE_HOLDOUT_SAMPLE,
  STAGE7C_PROSPECTIVE_HOLDOUT_START,
  runStage7CProspectiveHoldout,
} from "./stage7c-1x2-calibration";
import type { Stage7HoldoutFixture } from "./stage7-1x2-calibration";

function fixture(index: number, league: string): Stage7HoldoutFixture {
  const withinBlock = index % 80;
  const outcome = withinBlock < 40 ? "HOME" : withinBlock < 60 ? "DRAW" : "AWAY";
  return {
    fixtureId: String(index + 1),
    predictionAt: "2026-09-14T12:45:00-03:00",
    fixtureDate: `2026-09-${String(16 + Math.floor(index / 120)).padStart(2, "0")}`,
    league,
    raw: { HOME: 0.60, DRAW: 0.20, AWAY: 0.20 },
    calibrated: { HOME: 0.50, DRAW: 0.25, AWAY: 0.25 },
    outcome,
  };
}

describe("Stage 7C prospective 1X2 holdout", () => {
  it("keeps the final evidence pending below 200 completed fixtures", () => {
    const rows = Array.from({ length: 40 }, (_, index) => fixture(index, "league-a"));
    const report = runStage7CProspectiveHoldout(rows);
    expect(report.readinessStatus).toBe("PROSPECTIVE_HOLDOUT_PENDING");
    expect(report.prospectiveHoldout.requiredFixtures).toBe(STAGE7C_MIN_PROSPECTIVE_HOLDOUT_SAMPLE);
    expect(report.promotion.productionValidated).toBe(false);
  });

  it("can pass the statistical holdout while still requiring explicit promotion", () => {
    const leagues = ["league-a", "league-b", "league-c"];
    const rows = Array.from({ length: 240 }, (_, index) => fixture(index, leagues[Math.floor(index / 80)] ?? "league-c"));
    const report = runStage7CProspectiveHoldout(rows);
    expect(report.readinessStatus).toBe("HOLDOUT_PASSED");
    expect(report.prospectiveHoldout.calibratedMetrics.brier).toBeLessThan(report.prospectiveHoldout.rawMetrics.brier);
    expect(report.prospectiveHoldout.calibratedMetrics.maxCalibrationGap).toBeLessThanOrEqual(0.1);
    expect(report.promotion.productionValidated).toBe(false);
  });

  it("binds Stage 7C to the frozen exact model and future holdout date", () => {
    expect(STAGE7C_1X2_TARGET_MODEL).toBe("goals-baseline-v2-recency+elo-v1-w020");
    expect(STAGE7C_1X2_CALIBRATION_VERSION).toBe("joint-logit-v1-fit-through-2026-05-31");
    expect(STAGE7C_PROSPECTIVE_HOLDOUT_START).toBe("2026-09-14");
  });
});
