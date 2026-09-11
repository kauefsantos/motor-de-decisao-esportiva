import { describe, expect, it } from "vitest";

import { selectExperimentalPortfolio, type PortfolioCandidate } from "./portfolio-selection";

function candidate(id: string, matchId: string, ev: number): PortfolioCandidate {
  return {
    candidateId: id,
    predictionId: id,
    odd: 2,
    impliedProbability: 0.5,
    fairOdd: 1.6,
    minOddTarget: 1.632,
    decisionProbability: 0.6,
    probabilityBasis: "RAW_EXPERIMENTAL",
    edgeCons: 0.1,
    evCons: ev,
    wEff: null,
    lEff: null,
    probabilityStatus: "APROVADA",
    valueStatus: "TEM_VALOR",
    executionStatus: "EXECUTAVEL",
    rejectionReason: null,
    matchId,
    family: "GOALS",
    market: "goals_match_total",
    participant: null,
    side: "OVER",
  };
}

describe("experimental portfolio selection", () => {
  it("keeps only one automatic selection per match", () => {
    const result = selectExperimentalPortfolio(
      [candidate("m1-best", "m1", 0.3), candidate("m1-second", "m1", 0.25), candidate("m2", "m2", 0.2)],
      3,
    );
    expect(result.selected.map((row) => row.predictionId)).toEqual(["m1-best", "m2"]);
    expect(result.correlatedAlternates.map((row) => row.predictionId)).toContain("m1-second");
  });

  it("does not force the requested limit", () => {
    const result = selectExperimentalPortfolio([candidate("only", "m1", 0.03)], 3);
    expect(result.selected).toHaveLength(1);
  });

  it("keeps correlation filtering separate from value qualification", () => {
    const noValue = { ...candidate("no-value", "m3", 0), valueStatus: "SEM_VALOR" as const, executionStatus: "NAO_EXECUTAR" as const };
    const result = selectExperimentalPortfolio([noValue, candidate("good", "m2", 0.08)], 2);
    expect(result.selected.map((row) => row.predictionId)).toEqual(["good"]);
    expect(result.correlatedAlternates).toHaveLength(0);
  });
});
