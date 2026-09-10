import { describe, expect, it } from "vitest";
import { GOAL_OVER_LIMITS, GOAL_UNDER_LIMITS, absoluteCountProbability, bookmakerLineForAbsoluteLimit, buildGoalMarketProjections, familyForMarket } from "./experimental-goal-markets";

const markets = buildGoalMarketProjections({ homeTeam: "Time A", awayTeam: "Time B", lambdaHome: 1.55, lambdaAway: 1.05 });

describe("experimental goal market projections", () => {
  it("uses only requested absolute binary goal limits", () => {
    expect(GOAL_OVER_LIMITS).toEqual([0, 1, 2, 3]);
    expect(GOAL_UNDER_LIMITS).toEqual([4, 3, 2, 1]);
    const totals = markets.filter((m) => m.market === "goals_match_total");
    expect(totals).toHaveLength(8);
    expect(totals.every((m) => m.contractType === "BINARY" && m.outcomeDistribution === null)).toBe(true);
    expect(totals.filter((m) => m.side === "OVER").map((m) => m.lineCanonical)).toEqual([0, 1, 2, 3]);
    expect(totals.filter((m) => m.side === "UNDER").map((m) => m.lineCanonical)).toEqual([4, 3, 2, 1]);
  });

  it("applies strict integer thresholds without push semantics", () => {
    const dist = new Map([[0, 0.1], [1, 0.2], [2, 0.3], [3, 0.4]]);
    expect(absoluteCountProbability(dist, 1, "OVER")).toBeCloseTo(0.7);
    expect(absoluteCountProbability(dist, 3, "UNDER")).toBeCloseTo(0.6);
    expect(bookmakerLineForAbsoluteLimit("OVER", 4)).toBe(4.5);
    expect(bookmakerLineForAbsoluteLimit("UNDER", 10)).toBe(9.5);
  });

  it("keeps 1X2 exhaustive and maps cards family", () => {
    const oneXtwo = markets.filter((m) => m.market === "1x2");
    expect(oneXtwo.reduce((sum, m) => sum + m.probability, 0)).toBeCloseTo(1, 8);
    expect(familyForMarket("cards_match_total")).toBe("CARDS");
  });
});
