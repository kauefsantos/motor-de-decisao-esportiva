import {
  STAGE6_GOALS_ELO_ARTIFACT,
  buildStage6GoalsPredictions,
  type Stage6GoalRow,
  type WalkForwardPrediction,
} from "./goals-walk-forward";
import {
  MODEL_VALIDATION_CALIBRATION_TOLERANCE,
  multiclassMetrics,
  type CalibrationBin,
  type MulticlassLabel,
  type MulticlassMetricInput,
  type MulticlassMetrics,
} from "./model-validation";
import {
  STAGE7_RETROSPECTIVE_END_EXCLUSIVE,
  STAGE7_1X2_TARGET_MODEL,
} from "./stage7-1x2-calibration";

export const STAGE8_1X2_ERROR_AUDIT_PROTOCOL = "stage8-1x2-error-audit-v1";
export const STAGE8_1X2_AUDIT_VERSION = "stage8-error-audit-2026-09-14-v1";
export const STAGE8_RETROSPECTIVE_START = "2026-06-01";
export const STAGE8_RETROSPECTIVE_END_EXCLUSIVE = STAGE7_RETROSPECTIVE_END_EXCLUSIVE;
export const STAGE8_STRUCTURAL_BIN_MIN = 30;

const LABELS: MulticlassLabel[] = ["HOME", "DRAW", "AWAY"];

type ProbabilityMode = "MODEL" | "NO_ELO" | "BASELINE";

type WorstGap = {
  label: MulticlassLabel;
  from: number;
  to: number;
  count: number;
  predicted: number;
  observed: number;
  gap: number;
  signedError: number;
  direction: "OVERCONFIDENT" | "UNDERCONFIDENT";
} | null;

export type Stage8SliceSummary = {
  key: string;
  sampleSize: number;
  model: MetricSummary;
  noElo: MetricSummary;
  baseline: MetricSummary;
  meanProbabilityError: Record<MulticlassLabel, number>;
  worstGap: WorstGap;
  structuralWorstGap: WorstGap;
  eloBrierDelta: number;
  eloLogLossDelta: number;
};

type MetricSummary = {
  brier: number;
  logLoss: number;
  expectedCalibrationError: number;
  maxCalibrationGap: number;
};

function probabilityRecord(row: WalkForwardPrediction, mode: ProbabilityMode): Record<MulticlassLabel, number> {
  if (mode === "NO_ELO") {
    return {
      HOME: row.noEloHomeProbability,
      DRAW: row.noEloDrawProbability,
      AWAY: row.noEloAwayProbability,
    };
  }
  if (mode === "BASELINE") {
    return {
      HOME: row.baselineHomeProbability,
      DRAW: row.baselineDrawProbability,
      AWAY: row.baselineAwayProbability,
    };
  }
  return {
    HOME: row.homeProbability,
    DRAW: row.drawProbability,
    AWAY: row.awayProbability,
  };
}

function metricInputs(rows: readonly WalkForwardPrediction[], mode: ProbabilityMode): MulticlassMetricInput[] {
  return rows.map((row) => ({ probabilities: probabilityRecord(row, mode), outcome: row.outcome1x2 }));
}

function metricSummary(metrics: MulticlassMetrics): MetricSummary {
  return {
    brier: metrics.brier,
    logLoss: metrics.logLoss,
    expectedCalibrationError: metrics.expectedCalibrationError,
    maxCalibrationGap: metrics.maxCalibrationGap,
  };
}

function gapFromBin(label: MulticlassLabel, bin: CalibrationBin): NonNullable<WorstGap> {
  const signedError = bin.predicted - bin.observed;
  return {
    label,
    from: bin.from,
    to: bin.to,
    count: bin.count,
    predicted: bin.predicted,
    observed: bin.observed,
    gap: Math.abs(signedError),
    signedError,
    direction: signedError >= 0 ? "OVERCONFIDENT" : "UNDERCONFIDENT",
  };
}

function worstGap(metrics: MulticlassMetrics, minimumBinSize = 1): WorstGap {
  let worst: WorstGap = null;
  for (const label of LABELS) {
    for (const bin of metrics.calibration[label].calibration) {
      if (bin.count < minimumBinSize) continue;
      const candidate = gapFromBin(label, bin);
      if (!worst || candidate.gap > worst.gap) worst = candidate;
    }
  }
  return worst;
}

function meanProbabilityError(rows: readonly WalkForwardPrediction[]): Record<MulticlassLabel, number> {
  const sums: Record<MulticlassLabel, number> = { HOME: 0, DRAW: 0, AWAY: 0 };
  for (const row of rows) {
    const probabilities = probabilityRecord(row, "MODEL");
    for (const label of LABELS) {
      sums[label] += probabilities[label] - (row.outcome1x2 === label ? 1 : 0);
    }
  }
  const n = Math.max(1, rows.length);
  return { HOME: sums.HOME / n, DRAW: sums.DRAW / n, AWAY: sums.AWAY / n };
}

function summarizeSlice(key: string, rows: readonly WalkForwardPrediction[]): Stage8SliceSummary {
  const model = multiclassMetrics(metricInputs(rows, "MODEL"));
  const noElo = multiclassMetrics(metricInputs(rows, "NO_ELO"));
  const baseline = multiclassMetrics(metricInputs(rows, "BASELINE"));
  return {
    key,
    sampleSize: rows.length,
    model: metricSummary(model),
    noElo: metricSummary(noElo),
    baseline: metricSummary(baseline),
    meanProbabilityError: meanProbabilityError(rows),
    worstGap: worstGap(model),
    structuralWorstGap: worstGap(model, STAGE8_STRUCTURAL_BIN_MIN),
    eloBrierDelta: model.brier - noElo.brier,
    eloLogLossDelta: model.logLoss - noElo.logLoss,
  };
}

function groupedSlices(
  rows: readonly WalkForwardPrediction[],
  keyOf: (row: WalkForwardPrediction) => string,
  minimumSlice = 5,
): Stage8SliceSummary[] {
  const groups = new Map<string, WalkForwardPrediction[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length >= minimumSlice)
    .map(([key, group]) => summarizeSlice(key, group))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function band(value: number, cuts: Array<[number, string]>, fallback: string): string {
  for (const [upper, label] of cuts) if (value < upper) return label;
  return fallback;
}

function dominantSide(row: WalkForwardPrediction): MulticlassLabel {
  const probabilities = probabilityRecord(row, "MODEL");
  return LABELS.reduce((best, label) => probabilities[label] > probabilities[best] ? label : best, "HOME" as MulticlassLabel);
}

function dominantProbability(row: WalkForwardPrediction): number {
  const p = probabilityRecord(row, "MODEL");
  return Math.max(p.HOME, p.DRAW, p.AWAY);
}

function factorBand(value: number): string {
  return band(value, [[0.85, "<0.85"], [0.95, "0.85-0.95"], [1.05, "0.95-1.05"], [1.15, "1.05-1.15"]], ">=1.15");
}

function finiteOrMissing(value: number | null, keyOf: (value: number) => string): string {
  return value === null || !Number.isFinite(value) ? "MISSING" : keyOf(value);
}

function topEloEffects(dimensions: Record<string, Stage8SliceSummary[]>, direction: "IMPROVES" | "WORSENS") {
  return Object.entries(dimensions)
    .flatMap(([dimension, slices]) => slices.map((slice) => ({ dimension, ...slice })))
    .filter((slice) => slice.sampleSize >= STAGE8_STRUCTURAL_BIN_MIN)
    .filter((slice) => direction === "IMPROVES" ? slice.eloBrierDelta < 0 : slice.eloBrierDelta > 0)
    .sort((a, b) => direction === "IMPROVES" ? a.eloBrierDelta - b.eloBrierDelta : b.eloBrierDelta - a.eloBrierDelta)
    .slice(0, 12)
    .map((slice) => ({
      dimension: slice.dimension,
      key: slice.key,
      sampleSize: slice.sampleSize,
      eloBrierDelta: slice.eloBrierDelta,
      eloLogLossDelta: slice.eloLogLossDelta,
      modelMaxCalibrationGap: slice.model.maxCalibrationGap,
    }));
}

function temporalStability(months: Stage8SliceSummary[]) {
  const eligible = months.filter((slice) => slice.sampleSize >= 20);
  if (eligible.length < 2) return { evaluatedMonths: eligible.length, brierRange: null, eceRange: null, maxGapRange: null };
  const briers = eligible.map((slice) => slice.model.brier);
  const eces = eligible.map((slice) => slice.model.expectedCalibrationError);
  const gaps = eligible.map((slice) => slice.model.maxCalibrationGap);
  return {
    evaluatedMonths: eligible.length,
    brierRange: Math.max(...briers) - Math.min(...briers),
    eceRange: Math.max(...eces) - Math.min(...eces),
    maxGapRange: Math.max(...gaps) - Math.min(...gaps),
    first: eligible[0]?.key ?? null,
    last: eligible[eligible.length - 1]?.key ?? null,
  };
}

export function runStage8OneXTwoErrorAudit(sourceRows: readonly Stage6GoalRow[]) {
  const allPredictions = buildStage6GoalsPredictions(sourceRows, STAGE6_GOALS_ELO_ARTIFACT);
  const rows = allPredictions.filter(
    (row) => row.date >= STAGE8_RETROSPECTIVE_START && row.date < STAGE8_RETROSPECTIVE_END_EXCLUSIVE,
  );
  const overallModelMetrics = multiclassMetrics(metricInputs(rows, "MODEL"));
  const overallNoEloMetrics = multiclassMetrics(metricInputs(rows, "NO_ELO"));
  const overallBaselineMetrics = multiclassMetrics(metricInputs(rows, "BASELINE"));

  const dimensions: Record<string, Stage8SliceSummary[]> = {
    league: groupedSlices(rows, (row) => row.league),
    month: groupedSlices(rows, (row) => row.date.slice(0, 7)),
    favoriteSide: groupedSlices(rows, dominantSide),
    favoriteProbability: groupedSlices(rows, (row) => band(
      dominantProbability(row),
      [[0.45, "<0.45"], [0.55, "0.45-0.55"], [0.65, "0.55-0.65"], [0.75, "0.65-0.75"]],
      ">=0.75",
    )),
    eloDifference: groupedSlices(rows, (row) => finiteOrMissing(row.eloDifference, (value) => band(
      value,
      [[-150, "<-150"], [-75, "-150--75"], [75, "-75-75"], [150, "75-150"]],
      ">=150",
    ))),
    homeElo: groupedSlices(rows, (row) => finiteOrMissing(row.eloHomeRatingBefore, (value) => band(
      value,
      [[1450, "<1450"], [1500, "1450-1500"], [1550, "1500-1550"]],
      ">=1550",
    ))),
    awayElo: groupedSlices(rows, (row) => finiteOrMissing(row.eloAwayRatingBefore, (value) => band(
      value,
      [[1450, "<1450"], [1500, "1450-1500"], [1550, "1500-1550"]],
      ">=1550",
    ))),
    lambdaTotal: groupedSlices(rows, (row) => band(row.lambdaTotal, [[2, "<2.0"], [2.5, "2.0-2.5"], [3, "2.5-3.0"]], ">=3.0")),
    lambdaDifference: groupedSlices(rows, (row) => band(
      row.lambdaHome - row.lambdaAway,
      [[-0.75, "<-0.75"], [-0.25, "-0.75--0.25"], [0.25, "-0.25-0.25"], [0.75, "0.25-0.75"]],
      ">=0.75",
    )),
    leagueHomeGoalEdge: groupedSlices(rows, (row) => band(
      row.leagueMeanHome - row.leagueMeanAway,
      [[0, "<0"], [0.15, "0-0.15"], [0.3, "0.15-0.30"]],
      ">=0.30",
    )),
    goalSampleSize: groupedSlices(rows, (row) => band(row.goalsSampleSize, [[10, "<10"], [20, "10-19"], [40, "20-39"]], ">=40")),
    trainingMatches: groupedSlices(rows, (row) => band(row.trainingMatches, [[100, "<100"], [200, "100-199"], [400, "200-399"]], ">=400")),
    recentTrainingShare120: groupedSlices(rows, (row) => band(
      row.recentTrainingShare120,
      [[0.25, "<0.25"], [0.5, "0.25-0.50"], [0.75, "0.50-0.75"]],
      ">=0.75",
    )),
    homeAttackFactor: groupedSlices(rows, (row) => factorBand(row.homeAttackFactor)),
    homeDefenseFactor: groupedSlices(rows, (row) => factorBand(row.homeDefenseFactor)),
    awayAttackFactor: groupedSlices(rows, (row) => factorBand(row.awayAttackFactor)),
    awayDefenseFactor: groupedSlices(rows, (row) => factorBand(row.awayDefenseFactor)),
  };

  const officialWorstGap = worstGap(overallModelMetrics);
  const structuralWorstGap = worstGap(overallModelMetrics, STAGE8_STRUCTURAL_BIN_MIN);
  const homeCalibration = overallModelMetrics.calibration.HOME.calibration.map((bin) => gapFromBin("HOME", bin));

  return {
    protocolVersion: STAGE8_1X2_ERROR_AUDIT_PROTOCOL,
    auditVersion: STAGE8_1X2_AUDIT_VERSION,
    marketFamily: "1X2" as const,
    targetArtifact: STAGE7_1X2_TARGET_MODEL,
    readinessStatus: "AUDIT_COMPLETE_NO_PROMOTION" as const,
    sourceRows: sourceRows.length,
    eligiblePredictions: rows.length,
    window: {
      startInclusive: STAGE8_RETROSPECTIVE_START,
      endExclusive: STAGE8_RETROSPECTIVE_END_EXCLUSIVE,
      firstPredictionDate: rows[0]?.date ?? null,
      lastPredictionDate: rows[rows.length - 1]?.date ?? null,
    },
    governance: {
      benchmarkFrozen: true,
      formulaChanged: false,
      calibrationChanged: false,
      calibrationTolerance: MODEL_VALIDATION_CALIBRATION_TOLERANCE,
      toleranceRelaxed: false,
      promotionAttempted: false,
      productionValidated: false,
      realStakeUnlocked: false,
      holdoutStarted: false,
      finalHoldoutUsedForFeatureSelection: false,
    },
    overall: {
      model: overallModelMetrics,
      noElo: overallNoEloMetrics,
      baseline: overallBaselineMetrics,
      officialWorstGap,
      structuralWorstGap,
      structuralBinMinimum: STAGE8_STRUCTURAL_BIN_MIN,
      homeCalibration,
      eloBrierDelta: overallModelMetrics.brier - overallNoEloMetrics.brier,
      eloLogLossDelta: overallModelMetrics.logLoss - overallNoEloMetrics.logLoss,
    },
    dimensions,
    diagnostics: {
      temporalStability: temporalStability(dimensions.month ?? []),
      topEloImprovements: topEloEffects(dimensions, "IMPROVES"),
      topEloWorsening: topEloEffects(dimensions, "WORSENS"),
      officialGapComesFromSmallBucket: (officialWorstGap?.count ?? 0) < STAGE8_STRUCTURAL_BIN_MIN,
      structuralGapStillFailsTolerance: (structuralWorstGap?.gap ?? 0) > MODEL_VALIDATION_CALIBRATION_TOLERANCE,
    },
  };
}
