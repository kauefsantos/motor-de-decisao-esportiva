import { describe, expect, it } from "vitest";

import {
  applyOneXTwoTemperature,
  fitOneXTwoTemperature,
  oneXTwoLogLoss,
  type OneXTwoCalibrationInput,
} from "./multiclass-calibration";

describe("1X2 temperature scaling", () => {
  it("keeps T=1 as the normalized identity", () => {
    const output = applyOneXTwoTemperature({ HOME: 0.55, DRAW: 0.25, AWAY: 0.20 }, 1);
    expect(output.HOME).toBeCloseTo(0.55, 10);
    expect(output.DRAW).toBeCloseTo(0.25, 10);
    expect(output.AWAY).toBeCloseTo(0.20, 10);
    expect(output.HOME + output.DRAW + output.AWAY).toBeCloseTo(1, 12);
  });

  it("softens an over-confident synthetic sample without using a holdout", () => {
    const inputs: OneXTwoCalibrationInput[] = [];
    for (let index = 0; index < 120; index += 1) {
      inputs.push({
        probabilities: { HOME: 0.86, DRAW: 0.08, AWAY: 0.06 },
        outcome: index % 2 === 0 ? "HOME" : index % 4 === 1 ? "DRAW" : "AWAY",
      });
    }
    const fit = fitOneXTwoTemperature(inputs);
    expect(fit.temperature).toBeGreaterThan(1);
    expect(fit.logLossAfter).toBeLessThan(oneXTwoLogLoss(inputs, 1));
  });

  it("rejects invalid temperatures", () => {
    expect(() => applyOneXTwoTemperature({ HOME: 0.4, DRAW: 0.3, AWAY: 0.3 }, 0)).toThrow();
  });
});
