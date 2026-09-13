import { isLikelyDomesticLeagueKey } from "../../competition-kind";
import { applyEloToGoalLambdas, ELO_MODEL_VERSION } from "../../engine/elo";
import {
  fitGoalsBaseline,
  GOALS_MODEL_VERSION,
  goalOutcomeProbabilities,
  predictGoals,
  type GoalMatchRow,
} from "../../engine/goals";
import {
  MODEL_VALIDATION_CALIBRATION_TOLERANCE,
  MODEL_VALIDATION_LOOKBACK_DAYS,
  MODEL_VALIDATION_MIN_OOS_SAMPLE,
  assertUniqueFixtures,
  binaryMetrics,
  multiclassMetrics,
  temporalTrainingRows,
  type BinaryMetricInput,
  type MulticlassLabel,
  type MulticlassMetricInput,
} from "./model-validation";

export const STAGE6_GOALS_PROTOCOL = "stage6-goals-walk-forward-v1";
export const STAGE6_GOALS_BASE_ARTIFACT = GOALS_MODEL_VERSION;
export const STAGE6_GOALS_ELO_ARTIFACT = `${GOALS_MODEL_VERSION}+${ELO_MODEL_VERSION}`;

export type Stage6GoalsFamily = "1X2" | "BTTS";
export type Stage6GoalsArtifact = typeof STAGE6_GOALS_BASE_ARTIFACT | typeof STAGE6_GOALS_ELO_ARTIFACT;

export type Stage6GoalRow = {
  fixtureId: string;
  date: string;
  league: string;
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number;
  awayGoals: number;
  eloHomeRatingBefore: number | null;
  eloAwayRatingBefore: number | null;
  eloModelVersion: string | null;
};

type TemporalStage6GoalRow = Stage6GoalRow & {
  kickoffAt: number;
};

type WalkForwardPrediction = {
  fixtureId: string;
  date: string;
  league: string;
  modelVersion: Stage6GoalsArtifact;
  trainingMatches: number;
  homeProbability: number;
  drawProbability: number;
  awayProbability: number;
  bttsYesProbability: number;
  baselineHomeProbability: number;
  baselineDrawProbability: number;
  baselineAwayProbability: number;
  baselineBttsYesProbability: number;
  outcome1x2: MulticlassLabel;
  outcomeBtts: 0 | 1;
};

type SliceMetric = {
  key: string;
  predictions: number;
  modelBrier: number;
  baselineBrier: number;
  brierDelta: number;
  modelLogLoss: number;
  baselineLogLoss: number;
  logLossDelta: number;
  maxCalibrationGap: number;
};

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

function empiricalBaseline(training: Stage6GoalRow[]) {
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let btts = 0;
  for (const row of training) {
    if (row.homeGoals > row.awayGoals) homeWins += 1;
    else if (row.homeGoals === row.awayGoals) draws += 1;
    else awayWins += 1;
    if (row.homeGoals > 0 && row.awayGoals > 0) btts += 1;
  }
  const n = training.length;
  return {
    home: (homeWins + 1) / (n + 3),
    draw: (draws + 1) / (n + 3),
    away: (awayWins + 1) / (n + 3),
    bttsYes: (btts + 1) / (n + 2),
  };
}

function conservativeKickoffCutoff(date: string): number {
  const timestamp = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid Stage 6 fixture date: ${date}`);
  return timestamp;
}

export function buildStage6GoalsPredictions(
  sourceRows: readonly Stage6GoalRow[],
  artifact: Stage6GoalsArtifact,
): WalkForwardPrediction[] {
  assertUniqueFixtures(sourceRows);
  // The canonical result table has fixture_date but no exact kickoff timestamp. Start-of-day is used only
  // as a conservative ordering guard; temporalTrainingRows excludes the entire target calendar day.
  const domesticRows: TemporalStage6GoalRow[] = sourceRows
    .filter((row) => isLikelyDomesticLeagueKey(row.league))
    .map((row) => ({ ...row, kickoffAt: conservativeKickoffCutoff(row.date) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.fixtureId.localeCompare(b.fixtureId));
  const useElo = artifact === STAGE6_GOALS_ELO_ARTIFACT;
  const predictions: WalkForwardPrediction[] = [];

  for (const target of domesticRows) {
    const training = temporalTrainingRows(domesticRows, target.date, MODEL_VALIDATION_LOOKBACK_DAYS)
      .filter((r) => r.league === target.league && r.kickoffAt < target.kickoffAt);
    if (training.length < 3) continue;
    if (useElo && (
      target.eloModelVersion !== ELO_MODEL_VERSION
      || target.eloHomeRatingBefore === null
      || target.eloAwayRatingBefore === null
      || !Number.isFinite(target.eloHomeRatingBefore)
      || !Number.isFinite(target.eloAwayRatingBefore)
    )) continue;

    const params = fitGoalsBaseline(training.map(asGoalMatch), target.date);
    const rawForecast = predictGoals(params, {
      league: target.league,
      homeTeam: target.homeTeamId,
      awayTeam: target.awayTeamId,
    });
    const forecast = useElo
      ? applyEloToGoalLambdas(
          rawForecast.lambdaHome,
          rawForecast.lambdaAway,
          target.eloHomeRatingBefore as number,
          target.eloAwayRatingBefore as number,
        )
      : rawForecast;
    const probabilities = goalOutcomeProbabilities(forecast.lambdaHome, forecast.lambdaAway);
    const baseline = empiricalBaseline(training);
    const outcome1x2: MulticlassLabel = target.homeGoals > target.awayGoals
      ? "HOME"
      : target.homeGoals === target.awayGoals
        ? "DRAW"
        : "AWAY";

    predictions.push({
      fixtureId: target.fixtureId,
      date: target.date,
      league: target.league,
      modelVersion: artifact,
      trainingMatches: training.length,
      homeProbability: probabilities.home,
      drawProbability: probabilities.draw,
      awayProbability: probabilities.away,
      bttsYesProbability: probabilities.bttsYes,
      baselineHomeProbability: baseline.home,
      baselineDrawProbability: baseline.draw,
      baselineAwayProbability: baseline.away,
      baselineBttsYesProbability: baseline.bttsYes,
      outcome1x2,
      outcomeBtts: target.homeGoals > 0 && target.awayGoals > 0 ? 1 : 0,
    });
  }

  return predictions;
}

function oneXTwoInputs(rows: readonly WalkForwardPrediction[], baseline: boolean): MulticlassMetricInput[] {
  return rows.map((row) => ({
    probabilities: baseline
      ? { HOME: row.baselineHomeProbability, DRAW: row.baselineDrawProbability, AWAY: row.baselineAwayProbability }
      : { HOME: row.homeProbability, DRAW: row.drawProbability, AWAY: row.awayProbability },
    outcome: row.outcome1x2,
  }));
}

function bttsInputs(rows: readonly WalkForwardPrediction[], baseline: boolean): BinaryMetricInput[] {
  return rows.map((row) => ({
    probability: baseline ? row.baselineBttsYesProbability : row.bttsYesProbability,
    outcome: row.outcomeBtts,
  }));
}

function metricsFor(rows: readonly WalkForwardPrediction[], family: Stage6GoalsFamily, baseline: boolean) {
  return family === "1X2"
    ? multiclassMetrics(oneXTwoInputs(rows, baseline))
    : binaryMetrics(bttsInputs(rows, baseline));
}

function stabilityRows(
  rows: readonly WalkForwardPrediction[],
  family: Stage6GoalsFamily,
  keyOf: (row: WalkForwardPrediction) => string,
  minimumSlice: number,
): SliceMetric[] {
  const groups = new Map<string, WalkForwardPrediction[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length >= minimumSlice)
    .map(([key, group]) => {
      const model = metricsFor(group, family, false);
      const baseline = metricsFor(group, family, true);
      return {
        key,
        predictions: group.length,
        modelBrier: model.brier,
        baselineBrier: baseline.brier,
        brierDelta: model.brier - baseline.brier,
        modelLogLoss: model.logLoss,
        baselineLogLoss: baseline.logLoss,
        logLossDelta: model.logLoss - baseline.logLoss,
        maxCalibrationGap: model.maxCalibrationGap,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function runStage6GoalsWalkForward(
  sourceRows: readonly Stage6GoalRow[],
  family: Stage6GoalsFamily,
  artifact: Stage6GoalsArtifact,
) {
  const predictions = buildStage6GoalsPredictions(sourceRows, artifact);
  const modelMetrics = metricsFor(predictions, family, false);
  const baselineMetrics = metricsFor(predictions, family, true);
  const stabilityByLeague = stabilityRows(predictions, family, (row) => row.league, 30);
  const stabilityByPeriod = stabilityRows(predictions, family, (row) => row.date.slice(0, 7), 20);
  const enoughOutOfSamplePredictions = predictions.length >= MODEL_VALIDATION_MIN_OOS_SAMPLE;
  const beatsBaselineBrier = enoughOutOfSamplePredictions && modelMetrics.brier < baselineMetrics.brier;
  const beatsBaselineLogLoss = enoughOutOfSamplePredictions && modelMetrics.logLoss < baselineMetrics.logLoss;
  const calibrationWithinTolerance = enoughOutOfSamplePredictions
    && modelMetrics.maxCalibrationGap <= MODEL_VALIDATION_CALIBRATION_TOLERANCE;
  const enoughStabilityCoverage = stabilityByLeague.length >= 3 && stabilityByPeriod.length >= 3;
  const readinessStatus = !enoughOutOfSamplePredictions
    ? "INSUFFICIENT_DATA"
    : beatsBaselineBrier && beatsBaselineLogLoss && calibrationWithinTolerance && enoughStabilityCoverage
      ? "READY_FOR_CALIBRATION"
      : "VALIDATION_FAILED";

  return {
    protocolVersion: STAGE6_GOALS_PROTOCOL,
    marketFamily: family,
    targetArtifact: artifact,
    calibrationVersion: null,
    readinessStatus,
    sourceRows: sourceRows.length,
    eligiblePredictions: predictions.length,
    firstPredictionDate: predictions[0]?.date ?? null,
    lastPredictionDate: predictions[predictions.length - 1]?.date ?? null,
    lookbackDays: MODEL_VALIDATION_LOOKBACK_DAYS,
    runtimeParity: {
      goalsModelVersion: GOALS_MODEL_VERSION,
      eloModelVersion: artifact === STAGE6_GOALS_ELO_ARTIFACT ? ELO_MODEL_VERSION : null,
      sameDayTrainingExcluded: true,
      oddsUsedAsFeature: false,
      crossLeagueIncluded: false,
      eloSource: artifact === STAGE6_GOALS_ELO_ARTIFACT ? "elo_fixture_history.before" : null,
    },
    modelMetrics,
    baselineMetrics,
    stabilityByLeague,
    stabilityByPeriod,
    acceptance: {
      minimumTestMatches: MODEL_VALIDATION_MIN_OOS_SAMPLE,
      calibrationTolerance: MODEL_VALIDATION_CALIBRATION_TOLERANCE,
      enoughOutOfSamplePredictions,
      beatsBaselineBrier,
      beatsBaselineLogLoss,
      calibrationWithinTolerance,
      enoughStabilityCoverage,
      stableLeaguesEvaluated: stabilityByLeague.length,
      stablePeriodsEvaluated: stabilityByPeriod.length,
    },
    promotion: {
      productionValidated: false,
      reason: readinessStatus === "READY_FOR_CALIBRATION"
        ? "Predictive gate passed; temporal out-of-sample calibration is still required before any production promotion."
        : "Predictive validation did not establish all prerequisites for production promotion.",
    },
  };
}
