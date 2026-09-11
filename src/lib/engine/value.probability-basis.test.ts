import { describe, expect, it } from "vitest";

import { evaluateValue } from "./value";

function binaryInput(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: "candidate-1",
    predictionId: "prediction-1",
    contractType: "BINARY" as const,
    bookmaker: "bet365_br",
    odd: 2,
    lineAtEntry: null,
    lineCanonical: null,
    pCons: 0.55,
    outcomeDistribution: null,
    published: true,
    modelStatus: "EXPERIMENTAL_CURRENT_SEASON",
    dataStatus: "OK",
    ...overrides,
  };
}

describe("value probability basis", () => {
  it("marks the current experimental binary flow as raw rather than calibrated", () => {
    const result = evaluateValue(binaryInput());

    expect(result.decisionProbability).toBe(0.55);
    expect(result.probabilityBasis).toBe("RAW_EXPERIMENTAL");
    expect(result.evCons).toBeCloseTo(0.1, 12);
  });

  it("allows an explicit calibrated conservative basis without changing Motor 2 math", () => {
    const result = evaluateValue(binaryInput({
      pCons: 0.52,
      probabilityBasis: "CONSERVATIVE_CALIBRATED",
    }));

    expect(result.decisionProbability).toBe(0.52);
    expect(result.probabilityBasis).toBe("CONSERVATIVE_CALIBRATED");
    expect(result.fairOdd).toBeCloseTo(1 / 0.52, 12);
  });

  it("defaults non-experimental binary models to conservative calibrated semantics", () => {
    const result = evaluateValue(binaryInput({ modelStatus: "OK" }));

    expect(result.probabilityBasis).toBe("CONSERVATIVE_CALIBRATED");
  });

  it("rejects invalid binary probabilities above one", () => {
    const result = evaluateValue(binaryInput({ pCons: 1.01 }));

    expect(result.executionStatus).toBe("NAO_EXECUTAR");
    expect(result.rejectionReason).toBe("INSUFFICIENT_DATA");
  });
});
