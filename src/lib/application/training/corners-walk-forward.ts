import {
  CORNERS_MODEL_VERSION,
  EVAL_LINE,
  MIN_TEST_MATCHES,
  calibrationBins,
  fitBaseline,
  poissonDistribution,
  predict,
  probabilityOver,
  type CornerMatchRow,
} from "../../engine/corners";
import { chooseCountDistribution } from "../../engine/count-market-distribution";
import { MIN_EXPERIMENTAL_MATCHES } from "../experimental-markets/contracts";

export const STAGE4_CORNERS_PROTOCOL_VERSION = "stage4-corners-walk-forward-v1";
export const STAGE4_CORNERS_LOOKBACK_DAYS = 365;
export const STAGE4_CORNERS_TARGET_ARTIFACT = `${CORNERS_MODEL_VERSION}+nb2`;
export const STAGE4_CORNERS_POISSON_ARTIFACT = `${CORNERS_MODEL_VERSION}+poisson`;
export const STAGE4_CALIBRATION_TOLERANCE = 0.10;

export type Stage4CornerRow = CornerMatchRow & { fixtureId: string };

export type Stage4CornerPrediction = {
  fixtureId: string;
  date: string;
  league: string;
  trainingMatches: number;
  modelVersion: string;
  distribution: "negative_binomial" | "poisson";
  modelProbability: number;
  baselineProbability: number;
  modelLambda: number;
  baselineLambda: number;
  actual: number;
};

export type Stage4MetricSummary = {
  predictions: number;
  firstPredictionDate: string | null;
  lastPredictionDate: string | null;
  modelMae: number | null;
  baselineMae: number | null;
  modelBrier: number | null;
  baselineBrier: number | null;
  modelLogLoss: number | null;
  baselineLogLoss: number | null;
  maxCalibrationGap: number | null;
  expectedCalibrationError: number | null;
  calibration: ReturnType<typeof calibrationBins>;
};

export type Stage4LeagueStability = {
  league: string;
  predictions: number;
  modelBrier: number;
  baselineBrier: number;
  brierDelta: number;
  modelLogLoss: number;
  baselineLogLoss: number;
  logLossDelta: number;
  modelMae: number;
  baselineMae: number;
  maeDelta: number;
  maxCalibrationGap: number;
};

export type Stage4CornersReport = {
  protocolVersion: typeof STAGE4_CORNERS_PROTOCOL_VERSION;
  targetArtifact: typeof STAGE4_CORNERS_TARGET_ARTIFACT;
  fallbackArtifact: typeof STAGE4_CORNERS_POISSON_ARTIFACT;
  lookbackDays: number;
  evalLine: number;
  sourceRows: number;
  eligiblePredictions: number;
  nb2Predictions: number;
  poissonFallbackPredictions: number;
  skippedForTraining: number;
  runtime: Stage4MetricSummary;
  targetArtifactMetrics: Stage4MetricSummary;
  stabilityByLeague: Stage4LeagueStability[];
  acceptance: {
    minimumTestMatches: number;
    enoughOutOfSamplePredictions: boolean;
    beatsBaselineMae: boolean;
    beatsBaselineBrier: boolean;
    beatsBaselineLogLoss: boolean;
    calibrationWithinTolerance: boolean;
    calibrationTolerance: number;
    stableLeaguesEvaluated: number;
  };
  readinessStatus: "INSUFFICIENT_OOS_DATA" | "VALIDATION_FAILED" | "READY_FOR_CALIBRATION";
};

function dateMinusDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function logLoss(probability: number, outcome: boolean): number {
  const p = Math.min(1 - 1e-9, Math.max(1e-9, probability));
  return outcome ? -Math.log(p) : -Math.log(1 - p);
}

function summarize(predictions: Stage4CornerPrediction[]): Stage4MetricSummary {
  const calibration = calibrationBins(predictions.map((row) => ({ p: row.modelProbability, y: row.actual > EVAL_LINE })));
  const populatedBins = calibration.filter((bin) => bin.count > 0);
  const maxCalibrationGap = populatedBins.length
    ? Math.max(...populatedBins.map((bin) => Math.abs(bin.predicted - bin.observed)))
    : null;
  const expectedCalibrationError = predictions.length
    ? populatedBins.reduce(
        (total, bin) => total + (bin.count / predictions.length) * Math.abs(bin.predicted - bin.observed),
        0,
      )
    : null;
  const dates = predictions.map((row) => row.date).sort();
  return {
    predictions: predictions.length,
    firstPredictionDate: dates[0] ?? null,
    lastPredictionDate: dates[dates.length - 1] ?? null,
    modelMae: mean(predictions.map((row) => Math.abs(row.actual - row.modelLambda))),
    baselineMae: mean(predictions.map((row) => Math.abs(row.actual - row.baselineLambda))),
    modelBrier: mean(predictions.map((row) => (row.modelProbability - (row.actual > EVAL_LINE ? 1 : 0)) ** 2)),
    baselineBrier: mean(predictions.map((row) => (row.baselineProbability - (row.actual > EVAL_LINE ? 1 : 0)) ** 2)),
    modelLogLoss: mean(predictions.map((row) => logLoss(row.modelProbability, row.actual > EVAL_LINE))),
    baselineLogLoss: mean(predictions.map((row) => logLoss(row.baselineProbability, row.actual > EVAL_LINE))),
    maxCalibrationGap,
    expectedCalibrationError,
    calibration,
  };
}

function finiteMetric(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export function buildCornersWalkForwardPredictions(
  rows: Stage4CornerRow[],
  lookbackDays = STAGE4_CORNERS_LOOKBACK_DAYS,
): { predictions: Stage4CornerPrediction[]; skippedForTraining: number } {
  const byLeague = new Map<string, Stage4CornerRow[]>();
  for (const row of rows) {
    if (!row.date || !row.league || !Number.isFinite(row.homeCorners) || !Number.isFinite(row.awayCorners)) continue;
    const group = byLeague.get(row.league) ?? [];
    group.push(row);
    byLeague.set(row.league, group);
  }

  const predictions: Stage4CornerPrediction[] = [];
  let skippedForTraining = 0;
  for (const [league, leagueRows] of byLeague) {
    const sorted = [...leagueRows].sort((a, b) =>
      a.date === b.date ? a.fixtureId.localeCompare(b.fixtureId) : a.date.localeCompare(b.date),
    );
    for (const target of sorted) {
      const rollingStart = dateMinusDays(target.date, lookbackDays);
      // Runtime parity: prediction-service uses row.date < predictionDate, so no
      // fixture from the target calendar date can leak into training.
      const training = sorted.filter((row) => row.date < target.date && row.date >= rollingStart);
      if (training.length < MIN_EXPERIMENTAL_MATCHES) {
        skippedForTraining += 1;
        continue;
      }

      const params = fitBaseline(training);
      const forecast = predict(params, target);
      if (forecast.sampleSize <= 0) {
        skippedForTraining += 1;
        continue;
      }
      const distributionPolicy = chooseCountDistribution({
        market: "corners_match_total",
        lambda: forecast.lambdaTotal,
        estimatedAlpha: forecast.dispersionAlphaTotal,
        trainingMatches: training.length,
      });
      const modelProbability = probabilityOver(distributionPolicy.distribution, EVAL_LINE);
      const baselineLambda = training.reduce((sum, row) => sum + row.homeCorners + row.awayCorners, 0) / training.length;
      const baselineProbability = probabilityOver(poissonDistribution(baselineLambda, 60), EVAL_LINE);
      predictions.push({
        fixtureId: target.fixtureId,
        date: target.date,
        league,
        trainingMatches: training.length,
        modelVersion: distributionPolicy.kind === "negative_binomial"
          ? STAGE4_CORNERS_TARGET_ARTIFACT
          : STAGE4_CORNERS_POISSON_ARTIFACT,
        distribution: distributionPolicy.kind,
        modelProbability,
        baselineProbability,
        modelLambda: forecast.lambdaTotal,
        baselineLambda,
        actual: target.homeCorners + target.awayCorners,
      });
    }
  }
  return { predictions, skippedForTraining };
}

export function evaluateCornersWalkForward(rows: Stage4CornerRow[]): Stage4CornersReport {
  const { predictions, skippedForTraining } = buildCornersWalkForwardPredictions(rows);
  const nb2 = predictions.filter((row) => row.modelVersion === STAGE4_CORNERS_TARGET_ARTIFACT);
  const runtime = summarize(predictions);
  const targetArtifactMetrics = summarize(nb2);
  const stabilityByLeague = [...new Set(nb2.map((row) => row.league))]
    .map((league) => {
      const subset = nb2.filter((row) => row.league === league);
      const metrics = summarize(subset);
      if (
        subset.length < 30 ||
        !finiteMetric(metrics.modelBrier) || !finiteMetric(metrics.baselineBrier) ||
        !finiteMetric(metrics.modelLogLoss) || !finiteMetric(metrics.baselineLogLoss) ||
        !finiteMetric(metrics.modelMae) || !finiteMetric(metrics.baselineMae) ||
        !finiteMetric(metrics.maxCalibrationGap)
      ) return null;
      return {
        league,
        predictions: subset.length,
        modelBrier: metrics.modelBrier,
        baselineBrier: metrics.baselineBrier,
        brierDelta: metrics.modelBrier - metrics.baselineBrier,
        modelLogLoss: metrics.modelLogLoss,
        baselineLogLoss: metrics.baselineLogLoss,
        logLossDelta: metrics.modelLogLoss - metrics.baselineLogLoss,
        modelMae: metrics.modelMae,
        baselineMae: metrics.baselineMae,
        maeDelta: metrics.modelMae - metrics.baselineMae,
        maxCalibrationGap: metrics.maxCalibrationGap,
      } satisfies Stage4LeagueStability;
    })
    .filter((row): row is Stage4LeagueStability => row !== null)
    .sort((a, b) => b.predictions - a.predictions);

  const enoughOutOfSamplePredictions = nb2.length >= MIN_TEST_MATCHES;
  const beatsBaselineMae = finiteMetric(targetArtifactMetrics.modelMae) && finiteMetric(targetArtifactMetrics.baselineMae)
    ? targetArtifactMetrics.modelMae < targetArtifactMetrics.baselineMae
    : false;
  const beatsBaselineBrier = finiteMetric(targetArtifactMetrics.modelBrier) && finiteMetric(targetArtifactMetrics.baselineBrier)
    ? targetArtifactMetrics.modelBrier < targetArtifactMetrics.baselineBrier
    : false;
  const beatsBaselineLogLoss = finiteMetric(targetArtifactMetrics.modelLogLoss) && finiteMetric(targetArtifactMetrics.baselineLogLoss)
    ? targetArtifactMetrics.modelLogLoss < targetArtifactMetrics.baselineLogLoss
    : false;
  const calibrationWithinTolerance = finiteMetric(targetArtifactMetrics.maxCalibrationGap)
    ? targetArtifactMetrics.maxCalibrationGap <= STAGE4_CALIBRATION_TOLERANCE
    : false;
  const rawValidationPassed = enoughOutOfSamplePredictions && beatsBaselineMae && beatsBaselineBrier && beatsBaselineLogLoss && calibrationWithinTolerance;

  return {
    protocolVersion: STAGE4_CORNERS_PROTOCOL_VERSION,
    targetArtifact: STAGE4_CORNERS_TARGET_ARTIFACT,
    fallbackArtifact: STAGE4_CORNERS_POISSON_ARTIFACT,
    lookbackDays: STAGE4_CORNERS_LOOKBACK_DAYS,
    evalLine: EVAL_LINE,
    sourceRows: rows.length,
    eligiblePredictions: predictions.length,
    nb2Predictions: nb2.length,
    poissonFallbackPredictions: predictions.length - nb2.length,
    skippedForTraining,
    runtime,
    targetArtifactMetrics,
    stabilityByLeague,
    acceptance: {
      minimumTestMatches: MIN_TEST_MATCHES,
      enoughOutOfSamplePredictions,
      beatsBaselineMae,
      beatsBaselineBrier,
      beatsBaselineLogLoss,
      calibrationWithinTolerance,
      calibrationTolerance: STAGE4_CALIBRATION_TOLERANCE,
      stableLeaguesEvaluated: stabilityByLeague.length,
    },
    // Passing raw probability validation is deliberately NOT production promotion.
    // Calibration remains a separate Stage 4 artifact/gate.
    readinessStatus: !enoughOutOfSamplePredictions
      ? "INSUFFICIENT_OOS_DATA"
      : rawValidationPassed
        ? "READY_FOR_CALIBRATION"
        : "VALIDATION_FAILED",
  };
}
