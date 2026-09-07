import { describe, expect, it } from "vitest";

import {
  applyEloToGoalLambdas,
  eloExpectedScore,
  homeAdvantageFromPast,
  updateElo,
} from "./elo";

describe("elo-v1", () => {
  it("keeps ratings zero-sum after a result", () => {
    const result = updateElo({
      homeRating: 1500,
      awayRating: 1500,
      homeGoals: 2,
      awayGoals: 0,
      homeAdvantage: 60,
      k: 20,
    });
    expect(result.homeAfter).toBeGreaterThan(1500);
    expect(result.awayAfter).toBeLessThan(1500);
    expect(result.homeAfter + result.awayAfter).toBeCloseTo(3000, 10);
  });

  it("gives the stronger team a higher neutral expected score", () => {
    expect(eloExpectedScore(1700, 1500)).toBeGreaterThan(0.5);
    expect(eloExpectedScore(1500, 1700)).toBeLessThan(0.5);
  });

  it("preserves total expected goals when Elo tilts the split", () => {
    const adjusted = applyEloToGoalLambdas(1.4, 1.1, 1750, 1500);
    expect(adjusted.lambdaHome).toBeGreaterThan(1.4);
    expect(adjusted.lambdaAway).toBeLessThan(1.1);
    expect(adjusted.lambdaHome + adjusted.lambdaAway).toBeCloseTo(2.5, 10);
  });

  it("uses a conservative fallback home advantage for small samples", () => {
    expect(homeAdvantageFromPast(4, 8)).toBe(60);
  });
});
