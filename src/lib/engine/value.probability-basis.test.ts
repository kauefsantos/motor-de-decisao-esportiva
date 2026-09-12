import { describe, expect, it } from "vitest";

import {
  EV_TARGET,
  MIN_EDGE,
  MIN_ENTRY_ODD,
  MIN_MODEL_PROBABILITY,
  evaluateValue,
  passesMinimumOddGate,
  passesModelProbabilityGate,
} from "./value";

function binaryInput(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: "candidate-1",
    predictionId: "prediction-1",
    contractType: "BINARY" as const,
    bookmaker: "bet365_br",
    odd: 1.70,
    lineAtEntry: null,
    lineCanonical: null,
    pCons: 0.70,
    outcomeDistribution: null,
    published: true,
    modelStatus: "EXPERIMENTAL_CURRENT_SEASON",
    dataStatus: "OK",
    ...overrides,
  };
}

describe("value business-rule gates", () => {
  it("uses an inclusive probability gate at 70%", () => {
    expect(MIN_MODEL_PROBABILITY).toBe(0.70);
    expect(passesModelProbabilityGate(0.6999)).toBe(false);
    expect(passesModelProbabilityGate(0.70)).toBe(true);
  });

  it("uses an inclusive minimum odd of 1.70", () => {
    expect(MIN_ENTRY_ODD).toBe(1.70);
    expect(passesMinimumOddGate(1.69)).toBe(false);
    expect(passesMinimumOddGate(1.70)).toBe(true);
    expect(evaluateValue(binaryInput({ odd: 1.69 })).rejectionReason).toBe("ODD_BELOW_MINIMUM");
    expect(evaluateValue(binaryInput({ odd: 1.70 })).executionStatus).toBe("EXECUTAVEL");
  });

  it("requires EV >= 8% and edge >= 5 percentage points", () => {
    expect(EV_TARGET).toBe(0.08);
    expect(MIN_EDGE).toBe(0.05);
    const approved = evaluateValue(binaryInput({ pCons: 0.70, odd: 1.70 }));
    expect(approved.evCons).toBeCloseTo(0.19, 12);
    expect(approved.edgeCons).toBeGreaterThanOrEqual(0.05);
    expect(approved.executionStatus).toBe("EXECUTAVEL");

    const lowEv = evaluateValue(binaryInput({ pCons: 0.70, odd: 1.70, lineCanonical: null }));
    expect(lowEv.evCons).toBeGreaterThanOrEqual(EV_TARGET);
  });

  it("blocks probability before value when it is below 70%", () => {
    const result = evaluateValue(binaryInput({ pCons: 0.6999, odd: 4 }));
    expect(result.probabilityStatus).toBe("BLOQUEADA");
    expect(result.valueStatus).toBe("NAO_AVALIADO");
    expect(result.executionStatus).toBe("NAO_EXECUTAR");
    expect(result.rejectionReason).toBe("MODEL_PROBABILITY_BELOW_THRESHOLD");
    expect(result.evCons).toBeNull();
  });

  it("uses raw basis for approved experimental binary flow", () => {
    const result = evaluateValue(binaryInput());
    expect(result.decisionProbability).toBe(0.70);
    expect(result.probabilityBasis).toBe("RAW_EXPERIMENTAL");
    expect(result.probabilityStatus).toBe("APROVADA");
  });

  it("allows explicit calibrated conservative basis after the gates", () => {
    const result = evaluateValue(binaryInput({
      pCons: 0.72,
      probabilityBasis: "CONSERVATIVE_CALIBRATED",
    }));
    expect(result.probabilityBasis).toBe("CONSERVATIVE_CALIBRATED");
    expect(result.fairOdd).toBeCloseTo(1 / 0.72, 12);
  });

  it("defaults non-experimental binary models to conservative calibrated semantics", () => {
    const result = evaluateValue(binaryInput({ modelStatus: "OK" }));
    expect(result.probabilityBasis).toBe("CONSERVATIVE_CALIBRATED");
  });

  it("rejects invalid probabilities and non-OK data", () => {
    expect(evaluateValue(binaryInput({ pCons: 1.01 })).rejectionReason).toBe("INSUFFICIENT_DATA");
    expect(evaluateValue(binaryInput({ dataStatus: "INSUFFICIENT_DATA" })).executionStatus).toBe("NAO_EXECUTAR");
  });

  it("requires reforecast when the bookmaker line changed", () => {
    const result = evaluateValue(binaryInput({ lineCanonical: 2.5, lineAtEntry: 3.5 }));
    expect(result.rejectionReason).toBe("REFORECAST_REQUIRED");
    expect(result.executionStatus).toBe("NAO_EXECUTAR");
  });
});
