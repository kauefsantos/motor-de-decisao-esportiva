import { describe, expect, it } from "vitest";

import { selectExperimentalPortfolio, type PortfolioCandidate } from "./portfolio-selection";

function candidate(
  id: string,
  matchId: string,
  ev: number,
  decisionProbability = 0.75,
  odd = 1.80,
  family = "GOALS",
): PortfolioCandidate {
  return {
    candidateId: id,
    predictionId: id,
    odd,
    impliedProbability: 1 / odd,
    fairOdd: 1 / decisionProbability,
    minOddTarget: 1.70,
    decisionProbability,
    probabilityBasis: "RAW_EXPERIMENTAL",
    edgeCons: decisionProbability - (1 / odd),
    evCons: ev,
    wEff: null,
    lEff: null,
    probabilityStatus: decisionProbability >= 0.70 ? "APROVADA" : "BLOQUEADA",
    valueStatus: "TEM_VALOR",
    executionStatus: "EXECUTAVEL",
    rejectionReason: null,
    matchId,
    family,
    market: "goals_match_total",
    participant: null,
    side: "OVER",
  };
}

describe("experimental portfolio selection", () => {
  it("keeps only one automatic selection per match", () => {
    const result = selectExperimentalPortfolio(
      [candidate("m1-best", "m1", 0.30), candidate("m1-second", "m1", 0.25), candidate("m2", "m2", 0.20)],
      3,
    );
    expect(result.selected.map((row) => row.predictionId)).toEqual(["m1-best", "m2"]);
    expect(result.correlatedAlternates.map((row) => row.predictionId)).toContain("m1-second");
  });

  it("does not force three selections", () => {
    const result = selectExperimentalPortfolio([candidate("only", "m1", 0.10)], 3);
    expect(result.selected).toHaveLength(1);
  });

  it("accepts exactly 70% but rejects below 70%", () => {
    const result = selectExperimentalPortfolio(
      [candidate("below", "m1", 0.50, 0.6999), candidate("seventy", "m2", 0.19, 0.70, 1.70)],
      3,
    );
    expect(result.selected.map((row) => row.predictionId)).toEqual(["seventy"]);
  });

  it("rejects an odd below 1.70 even when probability and EV look attractive", () => {
    const result = selectExperimentalPortfolio([
      candidate("cheap", "m1", 0.30, 0.80, 1.69),
      candidate("floor", "m2", 0.19, 0.70, 1.70),
    ]);
    expect(result.selected.map((row) => row.predictionId)).toEqual(["floor"]);
  });

  it("does not expose stale rows below EV or edge thresholds", () => {
    const lowEv = { ...candidate("low-ev", "m1", 0.07), evCons: 0.07 };
    const lowEdge = { ...candidate("low-edge", "m2", 0.20), edgeCons: 0.049 };
    const good = candidate("good", "m3", 0.20);
    const result = selectExperimentalPortfolio([lowEv, lowEdge, good]);
    expect(result.selected.map((row) => row.predictionId)).toEqual(["good"]);
  });

  it("limits family concentration to two of the final three", () => {
    const result = selectExperimentalPortfolio([
      candidate("g1", "m1", 0.40, 0.75, 1.80, "GOALS"),
      candidate("g2", "m2", 0.35, 0.75, 1.80, "GOALS"),
      candidate("g3", "m3", 0.30, 0.75, 1.80, "GOALS"),
      candidate("c1", "m4", 0.25, 0.75, 1.80, "CORNERS"),
    ]);
    expect(result.selected.map((row) => row.predictionId)).toEqual(["g1", "g2", "c1"]);
    expect(result.correlatedAlternates.map((row) => row.predictionId)).toContain("g3");
  });

  it("keeps correlation filtering separate from value qualification", () => {
    const noValue = { ...candidate("no-value", "m3", 0), valueStatus: "SEM_VALOR" as const, executionStatus: "NAO_EXECUTAR" as const };
    const result = selectExperimentalPortfolio([noValue, candidate("good", "m2", 0.20)], 2);
    expect(result.selected.map((row) => row.predictionId)).toEqual(["good"]);
    expect(result.correlatedAlternates).toHaveLength(0);
  });
});
