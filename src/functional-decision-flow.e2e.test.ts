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
  family?: string;
  market?: string;
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
    family: input.family ?? "1X2",
    market: input.market ?? "1x2",
    participant: null,
    side: "HOME",
  };
}

describe("functional decision flow E2E", () => {
  it("accepts the inclusive >=70% gate before price collection", () => {
    const probabilities = [0.69, 0.70, 0.700001];
    expect(probabilities.filter(passesExperimentalModelGate)).toEqual([0.70, 0.700001]);
  });

  it("keeps MODEL_LEAN inclusive at the 70% boundary", () => {
    expect(strictDirectionFromProbabilities(0.70, 0.30)).toBe("OVER");
    expect(strictDirectionFromProbabilities(0.700001, 0.299999)).toBe("OVER");
    expect(strictDirectionFromProbabilities(0.299999, 0.700001)).toBe("UNDER");
  });

  it("runs probability -> real odd -> EV -> correlation -> diversification -> canonical daily limit of 3 deterministically", () => {
    const rows = [
      evaluated({ id: "a", matchId: "match-1", probability: 0.75, odd: 1.70 }),
      evaluated({ id: "b", matchId: "match-1", probability: 0.74, odd: 1.75 }),
      evaluated({ id: "c", matchId: "match-2", probability: 0.72, odd: 1.70, family: "TOTALS", market: "over_2_5" }),
      evaluated({ id: "d", matchId: "match-3", probability: 0.70, odd: 1.70 }),
      evaluated({ id: "e", matchId: "match-4", probability: 0.73, odd: 1.70, family: "BTTS", market: "btts_yes" }),
      evaluated({ id: "f", matchId: "match-5", probability: 0.80, odd: 1.69, family: "BTTS", market: "btts_yes" }),
    ];

    expect(rows[3]?.valueStatus).toBe("TEM_VALOR");
    expect(rows[3]?.executionStatus).toBe("EXECUTAVEL");
    expect(rows[5]?.rejectionReason).toBe("ODD_BELOW_MINIMUM");
    expect(rows.slice(0, 5).every((row) => row?.valueStatus === "TEM_VALOR")).toBe(true);

    const portfolio = selectExperimentalPortfolio(rows, 3);
    expect(portfolio.selected).toHaveLength(3);
    expect(new Set(portfolio.selected.map((row) => row.matchId)).size).toBe(3);
    expect(portfolio.selected.every((row) => row.odd >= 1.70)).toBe(true);
    expect(portfolio.selected.some((row) => row.predictionId === "f")).toBe(false);
    expect(portfolio.correlatedAlternates).toEqual([]);
  });
});
