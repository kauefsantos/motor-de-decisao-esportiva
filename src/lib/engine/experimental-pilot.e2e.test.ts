import { describe, expect, it } from "vitest";

import { fitGoalsBaseline, predictGoals, type GoalMatchRow } from "./goals";
import { buildGoalMarketProjections } from "./experimental-goal-markets";
import { evaluateValue, finalSelection } from "./value";
import { BASE_GATE } from "./opportunity";
import type { AsianOutcomeProbabilities } from "./types";

const LEAGUE = "Brazil Serie A";
const training: GoalMatchRow[] = [
  { date: "2026-08-01", league: LEAGUE, homeTeam: "A", awayTeam: "C", homeGoals: 3, awayGoals: 0 },
  { date: "2026-08-04", league: LEAGUE, homeTeam: "D", awayTeam: "B", homeGoals: 1, awayGoals: 0 },
  { date: "2026-08-08", league: LEAGUE, homeTeam: "A", awayTeam: "D", homeGoals: 2, awayGoals: 0 },
  { date: "2026-08-11", league: LEAGUE, homeTeam: "C", awayTeam: "B", homeGoals: 2, awayGoals: 0 },
  { date: "2026-08-15", league: LEAGUE, homeTeam: "A", awayTeam: "E", homeGoals: 3, awayGoals: 1 },
  { date: "2026-08-18", league: LEAGUE, homeTeam: "E", awayTeam: "B", homeGoals: 1, awayGoals: 0 },
  { date: "2026-08-22", league: LEAGUE, homeTeam: "C", awayTeam: "D", homeGoals: 1, awayGoals: 1 },
  { date: "2026-08-25", league: LEAGUE, homeTeam: "D", awayTeam: "E", homeGoals: 2, awayGoals: 1 },
  { date: "2026-08-29", league: LEAGUE, homeTeam: "A", awayTeam: "C", homeGoals: 4, awayGoals: 0 },
  { date: "2026-09-01", league: LEAGUE, homeTeam: "E", awayTeam: "B", homeGoals: 2, awayGoals: 0 },
  { date: "2026-09-03", league: LEAGUE, homeTeam: "C", awayTeam: "E", homeGoals: 1, awayGoals: 1 },
  { date: "2026-09-05", league: LEAGUE, homeTeam: "D", awayTeam: "C", homeGoals: 1, awayGoals: 0 },
];

describe("experimental pilot E2E", () => {
  it("runs history -> model -> markets -> 75% gate -> Motor 2 -> final selections", () => {
    const model = fitGoalsBaseline(training);
    const forecast = predictGoals(model, { league: LEAGUE, homeTeam: "A", awayTeam: "B" });

    expect(forecast.sampleSize).toBeGreaterThan(0);
    expect(forecast.lambdaHome).toBeGreaterThan(forecast.lambdaAway);

    const projections = buildGoalMarketProjections({
      homeTeam: "Time A",
      awayTeam: "Time B",
      lambdaHome: forecast.lambdaHome,
      lambdaAway: forecast.lambdaAway,
    });

    expect(projections.some((p) => p.family === "TEAM_GOALS")).toBe(true);
    expect(projections.some((p) => p.family === "DOUBLE_CHANCE")).toBe(true);
    expect(
      projections.some(
        (p) => p.family === "GOALS" && p.lineRaw === "0" && p.side === "OVER" && p.contractType === "BINARY",
      ),
    ).toBe(true);

    expect(BASE_GATE).toBe(0.75);
    const eligible = projections.filter((p) => p.probability >= BASE_GATE);
    expect(eligible.length).toBeGreaterThan(0);

    const evaluated = eligible.map((p, index) =>
      evaluateValue({
        candidateId: `cand-${index}`,
        predictionId: `pred-${index}`,
        contractType: p.contractType,
        bookmaker: "bet365_br",
        odd: 2,
        lineAtEntry: p.lineCanonical,
        lineCanonical: p.lineCanonical,
        pCons: p.contractType === "BINARY" ? p.probability : null,
        outcomeDistribution:
          p.contractType === "ASIAN"
            ? (p.outcomeDistribution as AsianOutcomeProbabilities)
            : null,
        published: true,
        modelStatus: "EXPERIMENTAL_CURRENT_SEASON",
        dataStatus: "OK",
      }),
    );

    expect(evaluated.some((r) => r.valueStatus === "TEM_VALOR")).toBe(true);
    const selected = finalSelection(evaluated);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThanOrEqual(3);
    expect(selected.every((r) => (r.evCons ?? 0) >= 0.02)).toBe(true);
  });
});
