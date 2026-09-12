import { describe, expect, it } from "vitest";

import { strictDirectionFromProbabilities } from "./lib/experimental-analysis.functions";
import { passesExperimentalModelGate } from "./lib/engine/market-policy";
import { evaluateValue } from "./lib/engine/value";
import { selectExperimentalPortfolio } from "./lib/engine/portfolio-selection";

function evaluated(input: {
  id: string;
  matchId: string;
  probability: number;
  odd: number;
}) {
  const result = evaluateValue({
    candidateId: input.id,
    predictionId: input.id,
    contractType: "BINARY",
    bookmaker: "bet365_br",
    odd: input.odd,
    lineAtEntry: null,
    lineCanonical: null,
    pCons: input.probability,
    outcomeDistribution: null,
    published: true,
    modelStatus: "EXPERIMENTAL_CURRENT_SEASON",
    dataStatus: "OK",
  });
  return {
    ...result,
    matchId: input.matchId,
    family: "1X2",
    market: "1x2",
    participant: null,
    side: "HOME",
  };
}

describe("functional decision flow E2E", () => {
  it("enforces the strict >70% gate before price collection", () => {
    const probabilities = [0.69, 0.70, 0.700001];
    expect(probabilities.filter(passesExperimentalModelGate)).toEqual([0.700001]);
  });

  it("keeps MODEL_LEAN strict at the 70% boundary", () => {
    expect(strictDirectionFromProbabilities(0.70, 0.30)).toBeNull();
    expect(strictDirectionFromProbabilities(0.700001, 0.299999)).toBe("OVER");
    expect(strictDirectionFromProbabilities(0.299999, 0.700001)).toBe("UNDER");
  });

  it("runs probability -> real odd -> EV -> correlation -> canonical daily limit of 3 deterministically", () => {
    const rows = [
      evaluated({ id: "a", matchId: "match-1", probability: 0.75, odd: 1.45 }),
      evaluated({ id: "b", matchId: "match-1", probability: 0.74, odd: 1.50 }),
      evaluated({ id: "c", matchId: "match-2", probability: 0.72, odd: 1.55 }),
      evaluated({ id: "d", matchId: "match-3", probability: 0.70, odd: 2.00 }),
      evaluated({ id: "e", matchId: "match-4", probability: 0.73, odd: 1.55 }),
    ];

    expect(rows[3]?.rejectionReason).toBe("MODEL_PROBABILITY_BELOW_THRESHOLD");
    expect([rows[0], rows[1], rows[2], rows[4]].every((row) => row?.valueStatus === "TEM_VALOR")).toBe(true);

    const portfolio = selectExperimentalPortfolio(rows, 3);
    expect(portfolio.selected).toHaveLength(3);
    expect(new Set(portfolio.selected.map((row) => row.matchId)).size).toBe(3);
    expect(portfolio.selected.some((row) => row.predictionId === "d")).toBe(false);
    expect(portfolio.correlatedAlternates.some((row) => row.matchId === "match-1")).toBe(true);
  });
});
