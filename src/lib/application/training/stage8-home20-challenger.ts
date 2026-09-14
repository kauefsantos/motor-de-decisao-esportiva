import { isLikelyDomesticLeagueKey } from "../../competition-kind";
import {
  applyEloToGoalLambdas,
  ELO_INITIAL_RATING,
  updateElo,
} from "../../engine/elo";
import {
  fitGoalsBaseline,
  goalOutcomeProbabilities,
  predictGoals,
  type GoalMatchRow,
} from "../../engine/goals";
import {
  MODEL_VALIDATION_LOOKBACK_DAYS,
  assertUniqueFixtures,
  multiclassMetrics,
  temporalTrainingRows,
  type MulticlassLabel,
  type MulticlassMetricInput,
} from "./model-validation";
import {
  STAGE6_GOALS_ELO_ARTIFACT,
  buildStage6GoalsPredictions,
  type Stage6GoalRow,
} from "./goals-walk-forward";

export const STAGE8_HOME20_ADVANTAGE = 20;
export const STAGE8_HOME20_ARTIFACT = "stage8-home20-fixed-v1";

type TemporalGoalRow = Stage6GoalRow & { kickoffAt: number };

type Home20RatingBefore = {
  homeRating: number;
  awayRating: number;
};

type IncumbentPrediction = ReturnType<typeof buildStage6GoalsPredictions>[number];

export type Stage8Home20Prediction = {
  fixtureId: string;
  date: string;
  league: string;
  homeProbability: number;
  drawProbability: number;
  awayProbability: number;
  homeRatingBefore: number;
  awayRatingBefore: number;
  outcome1x2: MulticlassLabel;
};

function conservativeKickoffCutoff(date: string): number {
  const timestamp = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid Stage 8 HOME20 fixture date: ${date}`);
  return timestamp;
}

function ratingKey(league: string, teamId: string): string {
  return `${league}::${teamId}`;
}

function fixtureKey(row: Pick<Stage6GoalRow, "league" | "fixtureId">): string {
  return `${row.league}::${row.fixtureId}`;
}

function asGoalMatch(row: Stage6GoalRow): GoalMatchRow {
  return {
    date: row.date,
    league: row.league,
    homeTeam: row.homeTeamId,
    awayTeam: row.awayTeamId,
    homeGoals: row.homeGoals,
    awayGoals: row.awayGoals,
  };
}

function outcomeFor(row: Stage6GoalRow): MulticlassLabel {
  if (row.homeGoals > row.awayGoals) return "HOME";
  if (row.homeGoals === row.awayGoals) return "DRAW";
  return "AWAY";
}

function domesticRows(sourceRows: readonly Stage6GoalRow[]): TemporalGoalRow[] {
  return sourceRows
    .filter((row) => isLikelyDomesticLeagueKey(row.league))
    .map((row) => ({ ...row, kickoffAt: conservativeKickoffCutoff(row.date) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.fixtureId.localeCompare(b.fixtureId));
}

/**
 * Replays local Elo with a fixed +20 point home advantage.
 * Ratings-before are snapshotted for the whole calendar day before any result
 * from that day is applied, matching the conservative no-same-day-leakage rule
 * used by the goals walk-forward when exact kickoff timestamps are unavailable.
 */
export function buildStage8Home20RatingsBefore(
  sourceRows: readonly Stage6GoalRow[],
): Map<string, Home20RatingBefore> {
  assertUniqueFixtures(sourceRows);
  const rows = domesticRows(sourceRows);
  const ratings = new Map<string, number>();
  const beforeByFixture = new Map<string, Home20RatingBefore>();

  let index = 0;
  while (index < rows.length) {
    const date = rows[index]?.date;
    if (!date) break;
    const dayRows: TemporalGoalRow[] = [];
    while (index < rows.length && rows[index]?.date === date) {
      const row = rows[index];
      if (row) dayRows.push(row);
      index += 1;
    }

    for (const row of dayRows) {
      const homeKey = ratingKey(row.league, row.homeTeamId);
      const awayKey = ratingKey(row.league, row.awayTeamId);
      beforeByFixture.set(fixtureKey(row), {
        homeRating: ratings.get(homeKey) ?? ELO_INITIAL_RATING,
        awayRating: ratings.get(awayKey) ?? ELO_INITIAL_RATING,
      });
    }

    const dayDeltas = new Map<string, number>();
    for (const row of dayRows) {
      const homeKey = ratingKey(row.league, row.homeTeamId);
      const awayKey = ratingKey(row.league, row.awayTeamId);
      const homeRating = ratings.get(homeKey) ?? ELO_INITIAL_RATING;
      const awayRating = ratings.get(awayKey) ?? ELO_INITIAL_RATING;
      const updated = updateElo({
        homeRating,
        awayRating,
        homeGoals: row.homeGoals,
        awayGoals: row.awayGoals,
        homeAdvantage: STAGE8_HOME20_ADVANTAGE,
      });
      dayDeltas.set(homeKey, (dayDeltas.get(homeKey) ?? 0) + updated.delta);
      dayDeltas.set(awayKey, (dayDeltas.get(awayKey) ?? 0) - updated.delta);
    }

    for (const [key, delta] of dayDeltas) {
      ratings.set(key, (ratings.get(key) ?? ELO_INITIAL_RATING) + delta);
    }
  }

  return beforeByFixture;
}

export function buildStage8Home20Predictions(
  sourceRows: readonly Stage6GoalRow[],
): Stage8Home20Prediction[] {
  assertUniqueFixtures(sourceRows);
  const rows = domesticRows(sourceRows);
  const ratingsBefore = buildStage8Home20RatingsBefore(sourceRows);
  const predictions: Stage8Home20Prediction[] = [];

  for (const target of rows) {
    const training = temporalTrainingRows(rows, target.date, MODEL_VALIDATION_LOOKBACK_DAYS)
      .filter((row) => row.league === target.league && row.kickoffAt < target.kickoffAt);
    if (training.length < 3) continue;

    const before = ratingsBefore.get(fixtureKey(target));
    if (!before) continue;

    const params = fitGoalsBaseline(training.map(asGoalMatch), target.date);
    const rawForecast = predictGoals(params, {
      league: target.league,
      homeTeam: target.homeTeamId,
      awayTeam: target.awayTeamId,
    });
    const adjusted = applyEloToGoalLambdas(
      rawForecast.lambdaHome,
      rawForecast.lambdaAway,
      before.homeRating,
      before.awayRating,
    );
    const probabilities = goalOutcomeProbabilities(adjusted.lambdaHome, adjusted.lambdaAway);

    predictions.push({
      fixtureId: target.fixtureId,
      date: target.date,
      league: target.league,
      homeProbability: probabilities.home,
      drawProbability: probabilities.draw,
      awayProbability: probabilities.away,
      homeRatingBefore: before.homeRating,
      awayRatingBefore: before.awayRating,
      outcome1x2: outcomeFor(target),
    });
  }

  return predictions;
}

function home20MetricInputs(rows: readonly Stage8Home20Prediction[]): MulticlassMetricInput[] {
  return rows.map((row) => ({
    probabilities: {
      HOME: row.homeProbability,
      DRAW: row.drawProbability,
      AWAY: row.awayProbability,
    },
    outcome: row.outcome1x2,
  }));
}

function incumbentMetricInputs(rows: readonly IncumbentPrediction[]): MulticlassMetricInput[] {
  return rows.map((row) => ({
    probabilities: {
      HOME: row.homeProbability,
      DRAW: row.drawProbability,
      AWAY: row.awayProbability,
    },
    outcome: row.outcome1x2,
  }));
}

function pairedDiagnosticMetrics(
  challengerRows: readonly Stage8Home20Prediction[],
  incumbentRows: readonly IncumbentPrediction[],
) {
  const fixtureKeys = new Set(challengerRows.map(fixtureKey));
  const incumbentSlice = incumbentRows.filter((row) => fixtureKeys.has(fixtureKey(row)));
  if (incumbentSlice.length !== challengerRows.length) {
    throw new Error(
      `Stage 8 HOME20 diagnostic pairing mismatch: incumbent=${incumbentSlice.length} challenger=${challengerRows.length}`,
    );
  }

  const incumbentMetrics = multiclassMetrics(incumbentMetricInputs(incumbentSlice));
  const challengerMetrics = multiclassMetrics(home20MetricInputs(challengerRows));
  return {
    sampleSize: challengerRows.length,
    incumbentBrier: incumbentMetrics.brier,
    home20Brier: challengerMetrics.brier,
    brierDelta: challengerMetrics.brier - incumbentMetrics.brier,
    incumbentLogLoss: incumbentMetrics.logLoss,
    home20LogLoss: challengerMetrics.logLoss,
    logLossDelta: challengerMetrics.logLoss - incumbentMetrics.logLoss,
    incumbentExpectedCalibrationError: incumbentMetrics.expectedCalibrationError,
    home20ExpectedCalibrationError: challengerMetrics.expectedCalibrationError,
    expectedCalibrationErrorDelta:
      challengerMetrics.expectedCalibrationError - incumbentMetrics.expectedCalibrationError,
    incumbentMaxCalibrationGap: incumbentMetrics.maxCalibrationGap,
    home20MaxCalibrationGap: challengerMetrics.maxCalibrationGap,
    maxCalibrationGapDelta: challengerMetrics.maxCalibrationGap - incumbentMetrics.maxCalibrationGap,
  };
}

export function runStage8Home20Challenger(
  sourceRows: readonly Stage6GoalRow[],
  startInclusive: string,
  endExclusive: string,
) {
  const incumbentAll = buildStage6GoalsPredictions(sourceRows, STAGE6_GOALS_ELO_ARTIFACT);
  const incumbentByFixture = new Map(
    incumbentAll
      .filter((row) => row.date >= startInclusive && row.date < endExclusive)
      .map((row) => [fixtureKey(row), row] as const),
  );
  const home20All = buildStage8Home20Predictions(sourceRows);
  const home20 = home20All.filter((row) => (
    row.date >= startInclusive
    && row.date < endExclusive
    && incumbentByFixture.has(fixtureKey(row))
  ));
  const incumbent = home20
    .map((row) => incumbentByFixture.get(fixtureKey(row)))
    .filter((row): row is NonNullable<typeof row> => row !== undefined);

  const incumbentMetrics = multiclassMetrics(incumbentMetricInputs(incumbent));
  const home20Metrics = multiclassMetrics(home20MetricInputs(home20));

  const monthKeys = [...new Set(home20.map((row) => row.date.slice(0, 7)))].sort();
  const stabilityByMonth = monthKeys.map((month) => ({
    month,
    ...pairedDiagnosticMetrics(
      home20.filter((row) => row.date.startsWith(month)),
      incumbent,
    ),
  }));

  const leagueKeys = [...new Set(home20.map((row) => row.league))].sort();
  const stabilityByLeague = leagueKeys.map((league) => ({
    league,
    ...pairedDiagnosticMetrics(
      home20.filter((row) => row.league === league),
      incumbent,
    ),
  }));

  return {
    challengerArtifact: STAGE8_HOME20_ARTIFACT,
    homeAdvantagePoints: STAGE8_HOME20_ADVANTAGE,
    pairedSampleSize: home20.length,
    incumbent: incumbentMetrics,
    challenger: home20Metrics,
    deltas: {
      brier: home20Metrics.brier - incumbentMetrics.brier,
      logLoss: home20Metrics.logLoss - incumbentMetrics.logLoss,
      expectedCalibrationError:
        home20Metrics.expectedCalibrationError - incumbentMetrics.expectedCalibrationError,
      maxCalibrationGap: home20Metrics.maxCalibrationGap - incumbentMetrics.maxCalibrationGap,
    },
    homeCalibration: {
      incumbent: incumbentMetrics.calibration.HOME.calibration,
      challenger: home20Metrics.calibration.HOME.calibration,
    },
    stabilityByMonth,
    stabilityByLeague,
    governance: {
      benchmarkFrozen: true,
      challengerFormulaChanged: true,
      incumbentModified: false,
      promotionAttempted: false,
      productionValidated: false,
      realStakeUnlocked: false,
    },
  };
}
