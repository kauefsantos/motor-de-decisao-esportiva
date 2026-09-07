import { describe, expect, it } from "vitest";

import {
  fitGoalsBaseline,
  goalOutcomeProbabilities,
  predictGoals,
  type GoalMatchRow,
} from "./goals";

const rows: GoalMatchRow[] = [
  { date: "2026-08-01", league: "test", homeTeam: "A", awayTeam: "B", homeGoals: 2, awayGoals: 1 },
  { date: "2026-08-02", league: "test", homeTeam: "C", awayTeam: "A", homeGoals: 1, awayGoals: 1 },
  { date: "2026-08-03", league: "test", homeTeam: "B", awayTeam: "C", homeGoals: 0, awayGoals: 2 },
  { date: "2026-08-04", league: "test", homeTeam: "A", awayTeam: "C", homeGoals: 3, awayGoals: 0 },
];

describe("goals-baseline-v1", () => {
  it("gera lambdas positivas e amostra observada", () => {
    const params = fitGoalsBaseline(rows);
    const prediction = predictGoals(params, { league: "test", homeTeam: "A", awayTeam: "C" });
    expect(prediction.lambdaHome).toBeGreaterThan(0);
    expect(prediction.lambdaAway).toBeGreaterThan(0);
    expect(prediction.lambdaTotal).toBeCloseTo(prediction.lambdaHome + prediction.lambdaAway, 10);
    expect(prediction.sampleSize).toBeGreaterThan(0);
  });

  it("1X2 soma 1 e BTTS sim/não soma 1", () => {
    const out = goalOutcomeProbabilities(1.6, 1.1);
    expect(out.home + out.draw + out.away).toBeCloseTo(1, 10);
    expect(out.bttsYes + out.bttsNo).toBeCloseTo(1, 10);
    for (const p of [out.home, out.draw, out.away, out.bttsYes, out.bttsNo]) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});
