import { describe, expect, it } from "vitest";

import {
  applyOneXTwoJointCalibration,
  fitOneXTwoJointCalibration,
  isOneXTwoJointCalibrationParameters,
} from "./multiclass-joint-calibration";
import type { OneXTwoCalibrationInput } from "./multiclass-calibration";

function biasedInputs(): OneXTwoCalibrationInput[] {
  return Array.from({ length: 400 }, (_, index) => ({
    probabilities: { HOME: 0.78, DRAW: 0.12, AWAY: 0.10 },
    outcome: index % 4 < 2 ? "HOME" : index % 4 === 2 ? "DRAW" : "AWAY",
  }));
}

describe("joint multiclass 1X2 calibration", () => {
  it("fits vector scaling without increasing fit log-loss on an over-confident sample", () => {
    const fit = fitOneXTwoJointCalibration(biasedInputs(), "vector_scaling", 0.01, {
      iterations: 260,
      learningRate: 0.05,
    });
    expect(fit.logLossAfter).toBeLessThan(fit.logLossBefore);
    expect(isOneXTwoJointCalibrationParameters(fit.parameters)).toBe(true);
  });

  it("fits regularized Dirichlet calibration and returns normalized probabilities", () => {
    const fit = fitOneXTwoJointCalibration(biasedInputs(), "dirichlet", 0.05, {
      iterations: 260,
      learningRate: 0.025,
    });
    const calibrated = applyOneXTwoJointCalibration(
      { HOME: 0.78, DRAW: 0.12, AWAY: 0.10 },
      { ...fit.parameters, blend: 0.75 },
    );
    expect(fit.logLossAfter).toBeLessThan(fit.logLossBefore);
    expect(calibrated.HOME + calibrated.DRAW + calibrated.AWAY).toBeCloseTo(1, 12);
    expect(Object.values(calibrated).every((value) => value > 0 && value < 1)).toBe(true);
  });

  it("fails closed for malformed persisted parameters", () => {
    expect(isOneXTwoJointCalibrationParameters({ kind: "joint_multiclass_logit" })).toBe(false);
  });
});
