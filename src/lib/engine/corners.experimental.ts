// VALIDAÇÃO EXPERIMENTAL — TEMPORADA ATUAL.
// Reutiliza EXATAMENTE corners-baseline-v1 (fitBaseline/predict/poissonDistribution).
// Nenhuma lógica do modelo é alterada aqui: apenas relaxa os mínimos de amostra
// para permitir DIAGNÓSTICO, com estado próprio EXPERIMENTAL_CURRENT_SEASON.
// Este estado nunca equivale a PRODUCTION_VALIDATED.

import {
  CORNERS_MODEL_VERSION,
  EVAL_LINE,
  MIN_TEST_MATCHES,
  MIN_TRAIN_MATCHES,
  calibrationBins,
  fitBaseline,
  poissonDistribution,
  predict,
  probabilityOver,
  sortChronologically,
  
  type CalibrationBin,
  type CornerMatchRow,
} from "./corners";

export const EXPERIMENTAL_STATUS = "EXPERIMENTAL_CURRENT_SEASON" as const;
export const PRODUCTION_BLOCK_REASON = "MODEL_NOT_PRODUCTION_VALIDATED" as const;

/** amostra mínima para cada métrica probabilística fazer sentido */
export const MIN_TEST_FOR_PROBABILISTIC = 30;
export const MIN_TEST_FOR_CALIBRATION = 50;
/** mínimo absoluto para sequer rodar o diagnóstico experimental */
export const MIN_EXPERIMENTAL_MATCHES = 3;
export const TEST_RATIO = 0.2;

export type MetricValue = number | "INSUFFICIENT_SAMPLE";

export interface ExperimentalPrediction {
  date: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  lambdaHome: number;
  lambdaAway: number;
  lambdaTotal: number;
  pOverEvalLine: number;
  actualTotal: number;
  sampleSize: number;
}

export interface ExperimentalMetrics {
  totalMatches: number;
  trainMatches: number;
  testMatches: number;
  evalLine: number;
  meanActualCorners: number;
  meanPredictedCorners: number;
  modelMae: number;
  modelRmse: number;
  baselineMae: number;
  baselineRmse: number;
  modelBrier: MetricValue;
  baselineBrier: MetricValue;
  modelLogLoss: MetricValue;
  baselineLogLoss: MetricValue;
  calibration: CalibrationBin[] | "INSUFFICIENT_SAMPLE";
  beatsBaselineMae: boolean;
  beatsBaselineRmse: boolean;
}

export type ExperimentalOutcome =
  | {
      status: "INSUFFICIENT_MODEL_TRAINING_DATA";
      usableMatches: number;
      requiredMatches: number;
      productionStatus: typeof PRODUCTION_BLOCK_REASON;
    }
  | {
      status: typeof EXPERIMENTAL_STATUS;
      modelVersion: string;
      calibrationVersion: null;
      productionStatus: typeof PRODUCTION_BLOCK_REASON;
      metrics: ExperimentalMetrics;
      predictions: ExperimentalPrediction[];
      productionGap: {
        requiredTrain: number;
        requiredTest: number;
        missingMatches: number;
      };
    };

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function rmse(errors: number[]) {
  return errors.length ? Math.sqrt(mean(errors.map((e) => e * e))) : 0;
}
function logLoss(p: number, y: boolean) {
  const eps = 1e-9;
  const q = Math.min(1 - eps, Math.max(eps, p));
  return y ? -Math.log(q) : -Math.log(1 - q);
}

/** split cronológico com pelo menos 20% das partidas finais no teste (mín. 1). */
export function experimentalSplit(rows: CornerMatchRow[]) {
  const sorted = sortChronologically(rows);
  const testSize = Math.max(1, Math.round(sorted.length * TEST_RATIO));
  const cut = Math.max(1, sorted.length - testSize);
  return { train: sorted.slice(0, cut), test: sorted.slice(cut) };
}

export function validateExperimentalCurrentSeason(
  rows: CornerMatchRow[],
): ExperimentalOutcome {
  const usable = rows.filter(
    (r) => Number.isFinite(r.homeCorners) && Number.isFinite(r.awayCorners),
  );

  if (usable.length < MIN_EXPERIMENTAL_MATCHES) {
    return {
      status: "INSUFFICIENT_MODEL_TRAINING_DATA",
      usableMatches: usable.length,
      requiredMatches: MIN_EXPERIMENTAL_MATCHES,
      productionStatus: PRODUCTION_BLOCK_REASON,
    };
  }

  const { train, test } = experimentalSplit(usable);
  const params = fitBaseline(train);

  const predictions: ExperimentalPrediction[] = [];
  const baselineTotals: number[] = [];
  const baselineProbs: number[] = [];

  for (const r of test) {
    const pr = predict(params, r);
    const dist = poissonDistribution(pr.lambdaTotal);
    const leagueBase =
      (params.leagueMeanHome[r.league] ?? params.globalMeanHome) +
      (params.leagueMeanAway[r.league] ?? params.globalMeanAway);
    baselineTotals.push(leagueBase);
    baselineProbs.push(probabilityOver(poissonDistribution(leagueBase), EVAL_LINE));
    predictions.push({
      date: r.date,
      league: r.league,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      lambdaHome: pr.lambdaHome,
      lambdaAway: pr.lambdaAway,
      lambdaTotal: pr.lambdaTotal,
      pOverEvalLine: probabilityOver(dist, EVAL_LINE),
      actualTotal: r.homeCorners + r.awayCorners,
      sampleSize: pr.sampleSize,
    });
  }

  const actuals = predictions.map((p) => p.actualTotal);
  const modelErrors = predictions.map((p) => p.actualTotal - p.lambdaTotal);
  const baselineErrors = predictions.map((p, i) => p.actualTotal - (baselineTotals[i] ?? 0));
  const outcomes = predictions.map((p) => p.actualTotal > EVAL_LINE);

  const enoughProb = test.length >= MIN_TEST_FOR_PROBABILISTIC;
  const enoughCalib = test.length >= MIN_TEST_FOR_CALIBRATION;

  const metrics: ExperimentalMetrics = {
    totalMatches: usable.length,
    trainMatches: train.length,
    testMatches: test.length,
    evalLine: EVAL_LINE,
    meanActualCorners: mean(actuals),
    meanPredictedCorners: mean(predictions.map((p) => p.lambdaTotal)),
    modelMae: mean(modelErrors.map(Math.abs)),
    modelRmse: rmse(modelErrors),
    baselineMae: mean(baselineErrors.map(Math.abs)),
    baselineRmse: rmse(baselineErrors),
    modelBrier: enoughProb
      ? mean(predictions.map((p, i) => (p.pOverEvalLine - (outcomes[i] ? 1 : 0)) ** 2))
      : "INSUFFICIENT_SAMPLE",
    baselineBrier: enoughProb
      ? mean(baselineProbs.map((p, i) => (p - (outcomes[i] ? 1 : 0)) ** 2))
      : "INSUFFICIENT_SAMPLE",
    modelLogLoss: enoughProb
      ? mean(predictions.map((p, i) => logLoss(p.pOverEvalLine, outcomes[i] ?? false)))
      : "INSUFFICIENT_SAMPLE",
    baselineLogLoss: enoughProb
      ? mean(baselineProbs.map((p, i) => logLoss(p, outcomes[i] ?? false)))
      : "INSUFFICIENT_SAMPLE",
    calibration: enoughCalib
      ? calibrationBins(predictions.map((p, i) => ({ p: p.pOverEvalLine, y: outcomes[i] ?? false })))
      : "INSUFFICIENT_SAMPLE",
    beatsBaselineMae: false,
    beatsBaselineRmse: false,
  };
  metrics.beatsBaselineMae = metrics.modelMae < metrics.baselineMae;
  metrics.beatsBaselineRmse = metrics.modelRmse < metrics.baselineRmse;

  return {
    status: EXPERIMENTAL_STATUS,
    modelVersion: CORNERS_MODEL_VERSION,
    calibrationVersion: null,
    productionStatus: PRODUCTION_BLOCK_REASON,
    metrics,
    predictions,
    productionGap: {
      requiredTrain: MIN_TRAIN_MATCHES,
      requiredTest: MIN_TEST_MATCHES,
      missingMatches: Math.max(0, MIN_TRAIN_MATCHES + MIN_TEST_MATCHES - usable.length),
    },
  };
}
