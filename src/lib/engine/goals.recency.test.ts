import { describe, expect, it } from "vitest";
import { fitGoalsBaseline, recencyWeight, predictGoals, type GoalMatchRow } from "./goals";

describe("goals-baseline-v2-recency", () => {
  it("gives recent matches more weight", () => {
    expect(recencyWeight(0)).toBeCloseTo(1, 8);
    expect(recencyWeight(120)).toBeCloseTo(0.5, 8);
    expect(recencyWeight(240)).toBeCloseTo(0.25, 8);
  });

  it("keeps sampleSize as real match count", () => {
    const rows: GoalMatchRow[] = [
      { date: "2026-01-01", league: "L", homeTeam: "A", awayTeam: "B", homeGoals: 1, awayGoals: 0 },
      { date: "2026-07-01", league: "L", homeTeam: "B", awayTeam: "A", homeGoals: 0, awayGoals: 2 },
      { date: "2026-08-01", league: "L", homeTeam: "A", awayTeam: "B", homeGoals: 3, awayGoals: 1 },
    ];
    const p = fitGoalsBaseline(rows, "2026-09-01");
    const out = predictGoals(p, { league: "L", homeTeam: "A", awayTeam: "B" });
    expect(out.sampleSize).toBe(3);
    expect(out.lambdaTotal).toBeGreaterThan(0);
  });
});
