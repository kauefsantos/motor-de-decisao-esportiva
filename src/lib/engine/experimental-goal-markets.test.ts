import { describe, expect, it } from "vitest";

import {
  absoluteCountProbability,
  bookmakerLineForAbsoluteLimit,
  buildGoalMarketProjections,
  familyForMarket,
} from "./experimental-goal-markets";

const markets = buildGoalMarketProjections({
  homeTeam: "Time A",
  awayTeam: "Time B",
  lambdaHome: 1.55,
  lambdaAway: 1.05,
});

describe("experimental goal quote markets", () => {
  it("exposes only 2.5 match goals plus 1X2 and double chance", () => {
    const totals = markets.filter((m) => m.market === "goals_match_total");
    expect(totals).toHaveLength(2);
    expect(totals.map((m) => [m.side, m.lineCanonical])).toEqual([
      ["OVER", 2.5],
      ["UNDER", 2.5],
    ]);
    expect(markets.filter((m) => m.market === "1x2")).toHaveLength(3);
    expect(markets.filter((m) => m.market === "double_chance")).toHaveLength(3);
    expect(markets.some((m) => m.market === "team_goals_total")).toBe(false);
    expect(markets.some((m) => m.market === "btts")).toBe(false);
    expect(markets).toHaveLength(8);
  });

  it("makes over/under probabilities complementary on the same half-line", () => {
    const over = markets.find((m) => m.market === "goals_match_total" && m.side === "OVER");
    const under = markets.find((m) => m.market === "goals_match_total" && m.side === "UNDER");
    expect(over).toBeDefined();
    expect(under).toBeDefined();
    expect((over?.probability ?? 0) + (under?.probability ?? 0)).toBeCloseTo(1, 10);
  });

  it("applies real bookmaker half-lines without asymmetric translation", () => {
    const dist = new Map([[0, 0.1], [1, 0.2], [2, 0.3], [3, 0.4]]);
    expect(absoluteCountProbability(dist, 1.5, "OVER")).toBeCloseTo(0.7);
    expect(absoluteCountProbability(dist, 1.5, "UNDER")).toBeCloseTo(0.3);
    expect(bookmakerLineForAbsoluteLimit("OVER", 4.5)).toBe(4.5);
    expect(bookmakerLineForAbsoluteLimit("UNDER", 4.5)).toBe(4.5);
  });

  it("keeps 1X2 exhaustive and maps cards family", () => {
    const oneXtwo = markets.filter((m) => m.market === "1x2");
    expect(oneXtwo.reduce((sum, m) => sum + m.probability, 0)).toBeCloseTo(1, 8);
    expect(familyForMarket("cards_match_total")).toBe("CARDS");
  });
});
