import { describe, expect, it } from "vitest";

import {
  STAGE6_GOALS_BASE_ARTIFACT,
  STAGE6_GOALS_ELO_ARTIFACT,
  buildStage6GoalsPredictions,
  runStage6GoalsWalkForward,
  type Stage6GoalRow,
} from "./goals-walk-forward";

function row(
  fixtureId: string,
  date: string,
  homeGoals: number,
  awayGoals: number,
  options: Partial<Stage6GoalRow> = {},
): Stage6GoalRow {
  return {
    fixtureId,
    date,
    league: "england-premier-league",
    homeTeamId: fixtureId === "2" ? "B" : "A",
    awayTeamId: fixtureId === "2" ? "A" : "B",
    homeGoals,
    awayGoals,
    eloHomeRatingBefore: 1500,
    eloAwayRatingBefore: 1500,
    eloModelVersion: "elo-v1-w020",
    ...options,
  };
}

const history: Stage6GoalRow[] = [
  row("1", "2026-01-01", 2, 0),
  row("2", "2026-01-02", 1, 1),
  row("3", "2026-01-03", 0, 1),
  row("4a", "2026-01-04", 3, 1, { eloHomeRatingBefore: 1700, eloAwayRatingBefore: 1300 }),
  row("4b", "2026-01-04", 1, 2),
  row("5", "2026-01-05", 2, 2, { eloHomeRatingBefore: 1650, eloAwayRatingBefore: 1350 }),
  row("6", "2026-01-06", 1, 0),
  row("7", "2026-01-07", 0, 3),
];

describe("Stage 6 GOALS walk-forward", () => {
  it("excludes every same-day fixture from the training set", () => {
    const predictions = buildStage6GoalsPredictions(history, STAGE6_GOALS_BASE_ARTIFACT);
    expect(predictions.find((prediction) => prediction.fixtureId === "4a")?.trainingMatches).toBe(3);
    expect(predictions.find((prediction) => prediction.fixtureId === "4b")?.trainingMatches).toBe(3);
  });

  it("changing a future result cannot change an earlier historical prediction", () => {
    const before = buildStage6GoalsPredictions(history, STAGE6_GOALS_BASE_ARTIFACT)
      .find((prediction) => prediction.fixtureId === "5");
    const mutated = history.map((item) => item.fixtureId === "7" ? { ...item, homeGoals: 12, awayGoals: 12 } : item);
    const after = buildStage6GoalsPredictions(mutated, STAGE6_GOALS_BASE_ARTIFACT)
      .find((prediction) => prediction.fixtureId === "5");
    expect(after?.homeProbability).toBe(before?.homeProbability);
    expect(after?.drawProbability).toBe(before?.drawProbability);
    expect(after?.awayProbability).toBe(before?.awayProbability);
  });

  it("uses the fixture point-in-time Elo snapshot for the Elo artifact", () => {
    const base = buildStage6GoalsPredictions(history, STAGE6_GOALS_BASE_ARTIFACT)
      .find((prediction) => prediction.fixtureId === "5");
    const elo = buildStage6GoalsPredictions(history, STAGE6_GOALS_ELO_ARTIFACT)
      .find((prediction) => prediction.fixtureId === "5");
    expect(elo).toBeDefined();
    expect(elo?.modelVersion).toBe(STAGE6_GOALS_ELO_ARTIFACT);
    expect(elo?.homeProbability).not.toBe(base?.homeProbability);
  });

  it("does not let a future Elo snapshot contaminate an earlier prediction", () => {
    const before = buildStage6GoalsPredictions(history, STAGE6_GOALS_ELO_ARTIFACT)
      .find((prediction) => prediction.fixtureId === "5");
    const mutated = history.map((item) => item.fixtureId === "7"
      ? { ...item, eloHomeRatingBefore: 2200, eloAwayRatingBefore: 900 }
      : item);
    const after = buildStage6GoalsPredictions(mutated, STAGE6_GOALS_ELO_ARTIFACT)
      .find((prediction) => prediction.fixtureId === "5");
    expect(after?.homeProbability).toBe(before?.homeProbability);
  });

  it("keeps cross-league fixtures out of the domestic artifact", () => {
    const crossRows = [
      row("c1", "2026-01-01", 2, 1, { league: "uefa-champions-league" }),
      row("c2", "2026-01-02", 1, 1, { league: "uefa-champions-league" }),
      row("c3", "2026-01-03", 0, 1, { league: "uefa-champions-league" }),
      row("c4", "2026-01-04", 3, 0, { league: "uefa-champions-league" }),
    ];
    const predictions = buildStage6GoalsPredictions([...history, ...crossRows], STAGE6_GOALS_BASE_ARTIFACT);
    expect(predictions.some((prediction) => prediction.fixtureId.startsWith("c"))).toBe(false);
  });

  it("never shares the report identity between base and Elo versions", () => {
    const base = runStage6GoalsWalkForward(history, "1X2", STAGE6_GOALS_BASE_ARTIFACT);
    const elo = runStage6GoalsWalkForward(history, "1X2", STAGE6_GOALS_ELO_ARTIFACT);
    expect(base.targetArtifact).toBe(STAGE6_GOALS_BASE_ARTIFACT);
    expect(elo.targetArtifact).toBe(STAGE6_GOALS_ELO_ARTIFACT);
    expect(base.targetArtifact).not.toBe(elo.targetArtifact);
    expect(base.readinessStatus).toBe("INSUFFICIENT_DATA");
    expect(elo.readinessStatus).toBe("INSUFFICIENT_DATA");
    expect(base.promotion.productionValidated).toBe(false);
    expect(elo.promotion.productionValidated).toBe(false);
  });
});
