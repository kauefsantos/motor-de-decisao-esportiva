import { describe, expect, it } from "vitest";

import {
  assertUniqueFixtures,
  binaryMetrics,
  multiclassMetrics,
  temporalTrainingRows,
} from "./model-validation";

describe("Stage 6 generic model validation", () => {
  it("never admits same-day or future fixtures into training", () => {
    const rows = [
      { fixtureId: "1", date: "2026-01-01" },
      { fixtureId: "2", date: "2026-01-02" },
      { fixtureId: "3", date: "2026-01-03" },
      { fixtureId: "4", date: "2026-01-04" },
    ];
    expect(temporalTrainingRows(rows, "2026-01-03").map((row) => row.fixtureId)).toEqual(["1", "2"]);
  });

  it("fails closed when a fixture appears twice", () => {
    expect(() => assertUniqueFixtures([
      { fixtureId: "same", date: "2026-01-01" },
      { fixtureId: "same", date: "2026-01-02" },
    ])).toThrow(/Duplicate validation fixture/);
  });

  it("computes binary calibration strictly from the supplied out-of-sample observations", () => {
    const result = binaryMetrics([
      { probability: 0.8, outcome: 1 },
      { probability: 0.7, outcome: 1 },
      { probability: 0.3, outcome: 0 },
      { probability: 0.2, outcome: 0 },
    ]);
    expect(result.sampleSize).toBe(4);
    expect(result.brier).toBeCloseTo(0.065, 12);
    expect(result.logLoss).toBeGreaterThan(0);
    expect(result.calibration.length).toBeGreaterThan(0);
  });

  it("uses multiclass Brier and log loss without collapsing 1X2 into a binary event", () => {
    const result = multiclassMetrics([
      { probabilities: { HOME: 0.6, DRAW: 0.25, AWAY: 0.15 }, outcome: "HOME" },
      { probabilities: { HOME: 0.2, DRAW: 0.3, AWAY: 0.5 }, outcome: "AWAY" },
    ]);
    expect(result.sampleSize).toBe(2);
    expect(result.brier).toBeGreaterThan(0);
    expect(result.calibration.HOME.sampleSize).toBe(2);
    expect(result.calibration.DRAW.sampleSize).toBe(2);
    expect(result.calibration.AWAY.sampleSize).toBe(2);
  });
});
