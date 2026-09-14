import { describe, expect, it } from "vitest";
import {
  STAGE9_1X2_TARGET_MODEL,
  applyStage9Calibration,
  isStage9CalibrationParameters,
  runStage9ProspectiveHoldout,
  type Stage9HoldoutFixture,
} from "./stage9-1x2-ensemble-calibration";

function holdoutRows(count: number): Stage9HoldoutFixture[] {
  return Array.from({ length: count }, (_, index) => {
    const outcome = (["HOME", "DRAW", "AWAY"] as const)[index % 3] ?? "HOME";
    const probabilities = { HOME: 1 / 3, DRAW: 1 / 3, AWAY: 1 / 3 };
    return {
      fixtureId: String(index + 1),
      predictionAt: "2026-09-14T12:00:00.000Z",
      fixtureDate: "2026-09-15",
      league: `league-${index % 3}`,
      raw: probabilities,
      calibrated: probabilities,
      outcome,
    };
  });
}

describe("Stage 9 1X2 ensemble calibration", () => {
  it("targets the exact uncertainty-linear 40% runtime model", () => {
    expect(STAGE9_1X2_TARGET_MODEL).toBe(
      "goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040",
    );
  });

  it("applies conservative prior shrinkage and preserves normalization", () => {
    const calibrated = applyStage9Calibration(
      { HOME: 0.8, DRAW: 0.12, AWAY: 0.08 },
      {
        kind: "prior_shrinkage",
        alpha: 0.1,
        priors: { HOME: 0.45, DRAW: 0.27, AWAY: 0.28 },
      },
    );
    expect(calibrated.HOME).toBeLessThan(0.8);
    expect(calibrated.HOME + calibrated.DRAW + calibrated.AWAY).toBeCloseTo(1, 12);
  });

  it("recognizes Stage 9 calibration parameters", () => {
    expect(isStage9CalibrationParameters({
      kind: "temperature_blend",
      temperature: 1.1,
      blend: 0.5,
    })).toBe(true);
    expect(isStage9CalibrationParameters({
      kind: "prior_shrinkage",
      alpha: 0.1,
      priors: { HOME: 0.45, DRAW: 0.27, AWAY: 0.28 },
    })).toBe(true);
  });

  it("keeps the untouched prospective holdout pending below 200 fixtures", () => {
    const report = runStage9ProspectiveHoldout(holdoutRows(199));
    expect(report.readinessStatus).toBe("PROSPECTIVE_HOLDOUT_PENDING");
    expect(report.promotion.productionValidated).toBe(false);
  });

  it("can pass only after 200+ settled fixtures satisfy every gate", () => {
    const report = runStage9ProspectiveHoldout(holdoutRows(210));
    expect(report.readinessStatus).toBe("HOLDOUT_PASSED");
    expect(report.prospectiveHoldout.acceptance.enoughData).toBe(true);
    expect(report.prospectiveHoldout.acceptance.calibrationWithinTolerance).toBe(true);
    expect(report.prospectiveHoldout.acceptance.enoughStabilityCoverage).toBe(true);
    expect(report.promotion.readyForExplicitPromotion).toBe(true);
    expect(report.promotion.productionValidated).toBe(false);
  });
});
