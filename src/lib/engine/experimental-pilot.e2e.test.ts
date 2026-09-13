import { describe, expect, it } from "vitest";

import { fitGoalsBaseline, predictGoals, type GoalMatchRow } from "./goals";
import { buildGoalMarketProjections } from "./experimental-goal-markets";
import { EV_TARGET, MIN_MODEL_PROBABILITY, evaluateValue, finalSelection } from "./value";

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
  it("runs history -> model -> strict confidence gate -> Motor 2 -> final selections", () => {
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

    expect(projections).toHaveLength(8);
    expect(projections.some((p) => p.family === "TEAM_GOALS")).toBe(false);
    expect(projections.some((p) => p.family === "BTTS")).toBe(false);
    expect(projections.filter((p) => p.family === "DOUBLE_CHANCE")).toHaveLength(3);
    expect(
      projections.some(
        (p) => p.family === "GOALS" && p.lineRaw === "2.5" && p.side === "OVER",
      ),
    ).toBe(true);

    const evaluated = projections.map((p, index) =>
      evaluateValue({
        candidateId: `cand-${index}`,
        predictionId: `pred-${index}`,
        contractType: p.contractType,
        bookmaker: "bet365_br",
        odd: 2,
        lineAtEntry: p.lineCanonical,
        lineCanonical: p.lineCanonical,
        pCons: p.probability,
        outcomeDistribution: null,
        published: true,
        modelStatus: "EXPERIMENTAL_CURRENT_SEASON",
        dataStatus: "OK",
      }),
    );

    const selected = finalSelection(evaluated);
    expect(selected.length).toBeLessThanOrEqual(3);
    expect(selected.every((r) => (r.decisionProbability ?? 0) >= MIN_MODEL_PROBABILITY)).toBe(true);
    expect(selected.every((r) => (r.evCons ?? 0) >= EV_TARGET)).toBe(true);
  });

  it("blocks a sub-70% probability even when the real price would create mathematical EV", () => {
    const result = evaluateValue({
      candidateId: "candidate-60pct",
      predictionId: "prediction-60pct",
      contractType: "BINARY",
      bookmaker: "bet365_br",
      odd: 2,
      lineAtEntry: 2.5,
      lineCanonical: 2.5,
      pCons: 0.6,
      outcomeDistribution: null,
      published: true,
      modelStatus: "EXPERIMENTAL_CURRENT_SEASON",
      dataStatus: "OK",
    });

    expect(result.evCons).toBeNull();
    expect(result.probabilityStatus).toBe("BLOQUEADA");
    expect(result.valueStatus).toBe("NAO_AVALIADO");
    expect(result.executionStatus).toBe("NAO_EXECUTAR");
    expect(result.rejectionReason).toBe("MODEL_PROBABILITY_BELOW_THRESHOLD");
  });
});
