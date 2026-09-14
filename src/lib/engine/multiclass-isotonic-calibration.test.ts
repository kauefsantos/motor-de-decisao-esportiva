import { describe, expect, it } from "vitest";

import {
  applyOneXTwoClasswiseIsotonic,
  fitOneXTwoClasswiseIsotonic,
  isOneXTwoIsotonicParameters,
} from "./multiclass-isotonic-calibration";
import type { OneXTwoCalibrationInput } from "./multiclass-calibration";

function trainingRows(): OneXTwoCalibrationInput[] {
  const rows: OneXTwoCalibrationInput[] = [];
  for (let index = 0; index < 900; index += 1) {
    const phase = index % 9;
    const probabilities = phase < 3
      ? { HOME: 0.68, DRAW: 0.20, AWAY: 0.12 }
      : phase < 6
        ? { HOME: 0.42, DRAW: 0.30, AWAY: 0.28 }
        : { HOME: 0.24, DRAW: 0.30, AWAY: 0.46 };
    const outcome = phase === 0 || phase === 1 || phase === 3 || phase === 4
      ? "HOME"
      : phase === 2 || phase === 5
        ? "DRAW"
        : "AWAY";
    rows.push({ probabilities, outcome });
  }
  return rows;
}

describe("class-wise isotonic 1X2 calibration", () => {
  it("fits monotone pre-binned curves and returns normalized probabilities", () => {
    const fitted = fitOneXTwoClasswiseIsotonic(trainingRows(), 15);
    const parameters = { ...fitted, blend: 0.5 } as const;
    expect(isOneXTwoIsotonicParameters(parameters)).toBe(true);
    for (const curve of Object.values(parameters.curves)) {
      expect(curve.x.length).toBeGreaterThanOrEqual(2);
      for (let index = 1; index < curve.y.length; index += 1) {
        expect(curve.y[index]!).toBeGreaterThanOrEqual(curve.y[index - 1]!);
      }
    }

    const result = applyOneXTwoClasswiseIsotonic(
      { HOME: 0.61, DRAW: 0.24, AWAY: 0.15 },
      parameters,
    );
    expect(result.HOME + result.DRAW + result.AWAY).toBeCloseTo(1, 12);
    expect(Object.values(result).every((value) => value > 0 && value < 1)).toBe(true);
  });

  it("rejects malformed persisted artifacts", () => {
    expect(isOneXTwoIsotonicParameters({ kind: "classwise_isotonic_blend", binCount: 2 })).toBe(false);
    expect(isOneXTwoIsotonicParameters({ kind: "temperature_scaling", temperature: 1.2 })).toBe(false);
  });
});
