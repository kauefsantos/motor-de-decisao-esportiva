import { describe, expect, it } from "vitest";

import { evaluateValue, MIN_MODEL_PROBABILITY, passesModelProbabilityGate } from "./value";

function binaryInput(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: "candidate-1",
    predictionId: "prediction-1",
    contractType: "BINARY" as const,
    bookmaker: "bet365_br",
    odd: 2,
    lineAtEntry: null,
    lineCanonical: null,
    pCons: 0.71,
    outcomeDistribution: null,
    published: true,
    modelStatus: "EXPERIMENTAL_CURRENT_SEASON",
    dataStatus: "OK",
    ...overrides,
  };
}

describe("value probability basis", () => {
  it("uses a strict greater-than 70% business gate", () => {
    expect(MIN_MODEL_PROBABILITY).toBe(0.70);
    expect(passesModelProbabilityGate(0.70)).toBe(false);
    expect(passesModelProbabilityGate(0.701)).toBe(true);
  });

  it("blocks a 33% opportunity before EV/value is evaluated", () => {
    const result = evaluateValue(binaryInput({ pCons: 0.33, odd: 4 }));

    expect(result.decisionProbability).toBe(0.33);
    expect(result.probabilityStatus).toBe("BLOQUEADA");
    expect(result.valueStatus).toBe("NAO_AVALIADO");
    expect(result.executionStatus).toBe("NAO_EXECUTAR");
    expect(result.rejectionReason).toBe("MODEL_PROBABILITY_BELOW_THRESHOLD");
    expect(result.evCons).toBeNull();
  });

  it("blocks exactly 70.0% even when the bookmaker price would imply positive EV", () => {
    const result = evaluateValue(binaryInput({ pCons: 0.70, odd: 2 }));

    expect(result.rejectionReason).toBe("MODEL_PROBABILITY_BELOW_THRESHOLD");
    expect(result.executionStatus).toBe("NAO_EXECUTAR");
    expect(result.evCons).toBeNull();
  });

  it("marks an approved experimental binary flow as raw rather than calibrated", () => {
    const result = evaluateValue(binaryInput());

    expect(result.decisionProbability).toBe(0.71);
    expect(result.probabilityBasis).toBe("RAW_EXPERIMENTAL");
    expect(result.evCons).toBeCloseTo(0.42, 12);
    expect(result.probabilityStatus).toBe("APROVADA");
  });

  it("allows an explicit calibrated conservative basis after the probability gate", () => {
    const result = evaluateValue(binaryInput({
      pCons: 0.72,
      probabilityBasis: "CONSERVATIVE_CALIBRATED",
    }));

    expect(result.decisionProbability).toBe(0.72);
    expect(result.probabilityBasis).toBe("CONSERVATIVE_CALIBRATED");
    expect(result.fairOdd).toBeCloseTo(1 / 0.72, 12);
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
