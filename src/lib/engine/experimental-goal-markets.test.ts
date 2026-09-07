import { describe, expect, it } from "vitest";

import { buildGoalMarketProjections, familyForMarket } from "./experimental-goal-markets";

describe("experimental goal market projections", () => {
  const markets = buildGoalMarketProjections({
    homeTeam: "Time A",
    awayTeam: "Time B",
    lambdaHome: 1.55,
    lambdaAway: 1.05,
  });

  it("derives all expanded families from one goal distribution", () => {
    const families = new Set(markets.map((m) => m.family));
    expect(families).toEqual(
      new Set(["GOALS", "TEAM_GOALS", "1X2", "DOUBLE_CHANCE", "BTTS"]),
    );
    expect(markets).toHaveLength(22);
  });

  it("keeps 1X2 exhaustive and double chance coherent", () => {
    const oneXtwo = markets.filter((m) => m.market === "1x2");
    const p = Object.fromEntries(oneXtwo.map((m) => [m.side, m.probability]));
    expect(p.HOME + p.DRAW + p.AWAY).toBeCloseTo(1, 8);

    const dc = Object.fromEntries(
      markets
        .filter((m) => m.market === "double_chance")
        .map((m) => [m.side, m.probability]),
    );
    expect(dc["1X"]).toBeCloseTo(p.HOME + p.DRAW, 8);
    expect(dc.X2).toBeCloseTo(p.DRAW + p.AWAY, 8);
    expect(dc["12"]).toBeCloseTo(p.HOME + p.AWAY, 8);
  });

  it("adds match over/under 1.5 and team goals 0.5/1.5 with Asian settlement", () => {
    const total15 = markets.filter(
      (m) => m.market === "goals_match_total" && m.lineRaw === "1.5",
    );
    expect(total15.map((m) => m.side).sort()).toEqual(["OVER", "UNDER"]);
    expect(total15.every((m) => m.contractType === "ASIAN" && m.outcomeDistribution)).toBe(true);

    const teamGoals = markets.filter((m) => m.market === "team_goals_total");
    expect(teamGoals).toHaveLength(8);
    expect(new Set(teamGoals.map((m) => m.participant))).toEqual(new Set(["Time A", "Time B"]));
    expect(new Set(teamGoals.map((m) => m.lineRaw))).toEqual(new Set(["0.5", "1.5"]));
  });

  it("maps persisted market names back to their families", () => {
    expect(familyForMarket("goals_match_total")).toBe("GOALS");
    expect(familyForMarket("team_goals_total")).toBe("TEAM_GOALS");
    expect(familyForMarket("double_chance")).toBe("DOUBLE_CHANCE");
  });
});
