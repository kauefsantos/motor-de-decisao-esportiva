import { describe, expect, it } from "vitest";

import {
  ONE_X_TWO_ENSEMBLE_WEIGHT,
  davidsonOneXTwoProbabilities,
  pureElo60DavidsonFromGoalHistory,
  uncertaintyLinearOneXTwo,
} from "./one-x-two-ensemble";

function sum(p: { HOME: number; DRAW: number; AWAY: number }) {
  return p.HOME + p.DRAW + p.AWAY;
}

describe("uncertainty-linear 40% 1X2 ensemble", () => {
  it("uses more Elo when the base forecast is uncertain", () => {
    const elo = { HOME: 0.6, DRAW: 0.24, AWAY: 0.16 };
    const uncertain = uncertaintyLinearOneXTwo(
      { HOME: 0.38, DRAW: 0.31, AWAY: 0.31 },
      elo,
    );
    const confident = uncertaintyLinearOneXTwo(
      { HOME: 0.75, DRAW: 0.15, AWAY: 0.1 },
      elo,
    );

    expect(ONE_X_TWO_ENSEMBLE_WEIGHT).toBe(0.4);
    expect(uncertain.HOME - 0.38).toBeGreaterThan(confident.HOME - 0.75);
    expect(sum(uncertain)).toBeCloseTo(1, 12);
    expect(sum(confident)).toBeCloseTo(1, 12);
  });

  it("returns proper Davidson probabilities", () => {
    const p = davidsonOneXTwoProbabilities(1500, 1500, 0.6);
    expect(sum(p)).toBeCloseTo(1, 12);
    expect(p.HOME).toBeGreaterThan(p.AWAY);
    expect(p.DRAW).toBeGreaterThan(0);
  });

  it("replays fixed +60 Elo with same-day conservative snapshots", () => {
    const rows = [
      { date: "2026-01-01", league: "league", homeTeam: "A", awayTeam: "B", homeGoals: 2, awayGoals: 0 },
      { date: "2026-01-02", league: "league", homeTeam: "C", awayTeam: "D", homeGoals: 1, awayGoals: 1 },
      { date: "2026-01-03", league: "league", homeTeam: "A", awayTeam: "C", homeGoals: 0, awayGoals: 1 },
      { date: "2026-01-04", league: "league", homeTeam: "B", awayTeam: "D", homeGoals: 1, awayGoals: 1 },
      { date: "2026-01-05", league: "league", homeTeam: "A", awayTeam: "D", homeGoals: 3, awayGoals: 1 },
      { date: "2026-01-06", league: "league", homeTeam: "B", awayTeam: "C", homeGoals: 0, awayGoals: 2 },
    ];

    const result = pureElo60DavidsonFromGoalHistory({
      rows,
      league: "league",
      homeTeam: "A",
      awayTeam: "B",
      drawWindowStart: "2026-01-01",
    });

    expect(result).not.toBeNull();
    expect(result?.trainingMatches).toBe(6);
    expect(result?.drawCoefficient).toBeGreaterThan(0);
    expect(sum(result!.probabilities)).toBeCloseTo(1, 12);
  });

  it("does not invent an Elo signal when a target team has no history", () => {
    const result = pureElo60DavidsonFromGoalHistory({
      rows: [
        { date: "2026-01-01", league: "league", homeTeam: "A", awayTeam: "B", homeGoals: 1, awayGoals: 0 },
        { date: "2026-01-02", league: "league", homeTeam: "B", awayTeam: "C", homeGoals: 1, awayGoals: 1 },
        { date: "2026-01-03", league: "league", homeTeam: "C", awayTeam: "A", homeGoals: 0, awayGoals: 1 },
      ],
      league: "league",
      homeTeam: "A",
      awayTeam: "Z",
      drawWindowStart: "2026-01-01",
    });
    expect(result).toBeNull();
  });
});
