import {
  applyOneXTwoTemperature,
  fitOneXTwoTemperature,
  type OneXTwoCalibrationInput,
  type OneXTwoLabel,
  type OneXTwoProbabilities,
} from "../../engine/multiclass-calibration";
import {
  STAGE6_GOALS_ELO_ARTIFACT,
  buildStage6GoalsPredictions,
  type Stage6GoalRow,
} from "./goals-walk-forward";
import {
  MODEL_VALIDATION_CALIBRATION_TOLERANCE,
  multiclassMetrics,
  type MulticlassMetricInput,
} from "./model-validation";

export const STAGE7_1X2_CALIBRATION_PROTOCOL = "stage7-1x2-elo-calibration-v1";
export const STAGE7_1X2_HOLDOUT_PROTOCOL = "stage7-1x2-elo-prospective-holdout-v1";
export const STAGE7_1X2_TARGET_MODEL = STAGE6_GOALS_ELO_ARTIFACT;
export const STAGE7_1X2_CALIBRATION_VERSION = "temperature-v1-fit-through-2026-05-31";
export const STAGE7_CALIBRATION_END_EXCLUSIVE = "2026-06-01";
export const STAGE7_RETROSPECTIVE_END_EXCLUSIVE = "2026-09-14";
export const STAGE7_PROSPECTIVE_HOLDOUT_START = "2026-09-14";
export const STAGE7_MIN_CALIBRATION_SAMPLE = 1000;
export const STAGE7_MIN_RETROSPECTIVE_SAMPLE = 300;
export const STAGE7_MIN_PROSPECTIVE_HOLDOUT_SAMPLE = 200;

export type Stage7Readiness =
  | "INSUFFICIENT_DATA"
  | "CALIBRATION_REJECTED"
  | "SHADOW_READY"
  | "PROSPECTIVE_HOLDOUT_PENDING"
  | "HOLDOUT_FAILED"
  | "HOLDOUT_PASSED";

type Stage6Prediction = ReturnType<typeof buildStage6GoalsPredictions>[number];

export type Stage7HoldoutFixture = {
  fixtureId: string;
  predictionAt: string;
  fixtureDate: string;
  league: string;
  raw: OneXTwoProbabilities;
  calibrated: OneXTwoProbabilities;
  outcome: OneXTwoLabel;
};

function rawProbabilities(row: Stage6Prediction): OneXTwoProbabilities {
  return { HOME: row.homeProbability, DRAW: row.drawProbability, AWAY: row.awayProbability };
}

function baselineProbabilities(row: Stage6Prediction): OneXTwoProbabilities {
  return {
    HOME: row.baselineHomeProbability,
    DRAW: row.baselineDrawProbability,
    AWAY: row.baselineAwayProbability,
  };
}

function asCalibrationInputs(rows: readonly Stage6Prediction[]): OneXTwoCalibrationInput[] {
  return rows.map((row) => ({ probabilities: rawProbabilities(row), outcome: row.outcome1x2 }));
}

function asMetricInputs(
  rows: readonly Stage6Prediction[],
  kind: "raw" | "baseline" | "calibrated",
  temperature: number,
): MulticlassMetricInput[] {
  return rows.map((row) => {
    const raw = rawProbabilities(row);
    const probabilities = kind === "raw"
      ? raw
      : kind === "baseline"
        ? baselineProbabilities(row)
        : applyOneXTwoTemperature(raw, temperature);
    return { probabilities, outcome: row.outcome1x2 };
  });
}

function stability(
  rows: readonly Stage6Prediction[],
  temperature: number,
  keyOf: (row: Stage6Prediction) => string,
  minimumSlice: number,
) {
  const groups = new Map<string, Stage6Prediction[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length >= minimumSlice)
    .map(([key, group]) => {
      const calibrated = multiclassMetrics(asMetricInputs(group, "calibrated", temperature));
      const raw = multiclassMetrics(asMetricInputs(group, "raw", temperature));
      return {
        key,
        predictions: group.length,
        calibratedBrier: calibrated.brier,
        rawBrier: raw.brier,
        calibratedLogLoss: calibrated.logLoss,
        rawLogLoss: raw.logLoss,
        maxCalibrationGap: calibrated.maxCalibrationGap,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function runStage7OneXTwoCalibration(sourceRows: readonly Stage6GoalRow[]) {
  const predictions = buildStage6GoalsPredictions(sourceRows, STAGE7_1X2_TARGET_MODEL);
  const calibrationRows = predictions.filter((row) => row.date < STAGE7_CALIBRATION_END_EXCLUSIVE);
  const retrospectiveRows = predictions.filter(
    (row) => row.date >= STAGE7_CALIBRATION_END_EXCLUSIVE && row.date < STAGE7_RETROSPECTIVE_END_EXCLUSIVE,
  );

  if (calibrationRows.length === 0) {
    return {
      protocolVersion: STAGE7_1X2_CALIBRATION_PROTOCOL,
      marketFamily: "1X2" as const,
      targetArtifact: STAGE7_1X2_TARGET_MODEL,
      calibrationVersion: STAGE7_1X2_CALIBRATION_VERSION,
      readinessStatus: "INSUFFICIENT_DATA" as Stage7Readiness,
      calibrationFit: null,
      retrospective: null,
      prospectiveHoldout: { startsAt: STAGE7_PROSPECTIVE_HOLDOUT_START, requiredFixtures: STAGE7_MIN_PROSPECTIVE_HOLDOUT_SAMPLE },
      promotion: { productionValidated: false, reason: "Calibration fitting window is empty." },
    };
  }

  const fit = fitOneXTwoTemperature(asCalibrationInputs(calibrationRows));
  const fitRawMetrics = multiclassMetrics(asMetricInputs(calibrationRows, "raw", fit.temperature));
  const fitCalibratedMetrics = multiclassMetrics(asMetricInputs(calibrationRows, "calibrated", fit.temperature));
  const shadowRawMetrics = multiclassMetrics(asMetricInputs(retrospectiveRows, "raw", fit.temperature));
  const shadowCalibratedMetrics = multiclassMetrics(asMetricInputs(retrospectiveRows, "calibrated", fit.temperature));
  const shadowBaselineMetrics = multiclassMetrics(asMetricInputs(retrospectiveRows, "baseline", fit.temperature));
  const stabilityByLeague = stability(retrospectiveRows, fit.temperature, (row) => row.league, 30);
  const stabilityByPeriod = stability(retrospectiveRows, fit.temperature, (row) => row.date.slice(0, 7), 20);

  const enoughCalibrationData = calibrationRows.length >= STAGE7_MIN_CALIBRATION_SAMPLE;
  const enoughRetrospectiveData = retrospectiveRows.length >= STAGE7_MIN_RETROSPECTIVE_SAMPLE;
  const preservesBrierAdvantage = enoughRetrospectiveData
    && shadowCalibratedMetrics.brier < shadowBaselineMetrics.brier;
  const preservesLogLossAdvantage = enoughRetrospectiveData
    && shadowCalibratedMetrics.logLoss < shadowBaselineMetrics.logLoss;
  const doesNotDegradeRawBrier = enoughRetrospectiveData
    && shadowCalibratedMetrics.brier <= shadowRawMetrics.brier;
  const doesNotDegradeRawLogLoss = enoughRetrospectiveData
    && shadowCalibratedMetrics.logLoss <= shadowRawMetrics.logLoss;
  const calibrationWithinTolerance = enoughRetrospectiveData
    && shadowCalibratedMetrics.maxCalibrationGap <= MODEL_VALIDATION_CALIBRATION_TOLERANCE;
  const enoughStabilityCoverage = stabilityByLeague.length >= 3 && stabilityByPeriod.length >= 3;

  const readinessStatus: Stage7Readiness = !enoughCalibrationData || !enoughRetrospectiveData
    ? "INSUFFICIENT_DATA"
    : preservesBrierAdvantage
      && preservesLogLossAdvantage
      && doesNotDegradeRawBrier
      && doesNotDegradeRawLogLoss
      && calibrationWithinTolerance
      && enoughStabilityCoverage
      ? "SHADOW_READY"
      : "CALIBRATION_REJECTED";

  return {
    protocolVersion: STAGE7_1X2_CALIBRATION_PROTOCOL,
    marketFamily: "1X2" as const,
    targetArtifact: STAGE7_1X2_TARGET_MODEL,
    calibrationVersion: STAGE7_1X2_CALIBRATION_VERSION,
    readinessStatus,
    windows: {
      calibration: {
        firstDate: calibrationRows[0]?.date ?? null,
        lastDate: calibrationRows[calibrationRows.length - 1]?.date ?? null,
        endExclusive: STAGE7_CALIBRATION_END_EXCLUSIVE,
      },
      retrospectiveShadow: {
        firstDate: retrospectiveRows[0]?.date ?? null,
        lastDate: retrospectiveRows[retrospectiveRows.length - 1]?.date ?? null,
        endExclusive: STAGE7_RETROSPECTIVE_END_EXCLUSIVE,
        isFinalHoldout: false,
      },
      prospectiveHoldout: {
        startsAt: STAGE7_PROSPECTIVE_HOLDOUT_START,
        requiredFixtures: STAGE7_MIN_PROSPECTIVE_HOLDOUT_SAMPLE,
      },
    },
    calibrationFit: {
      method: fit.method,
      parameters: { temperature: fit.temperature },
      bounds: fit.bounds,
      sampleSize: calibrationRows.length,
      logLossBefore: fit.logLossBefore,
      logLossAfter: fit.logLossAfter,
      rawMetrics: fitRawMetrics,
      calibratedMetrics: fitCalibratedMetrics,
    },
    retrospective: {
      sampleSize: retrospectiveRows.length,
      rawMetrics: shadowRawMetrics,
      calibratedMetrics: shadowCalibratedMetrics,
      baselineMetrics: shadowBaselineMetrics,
      stabilityByLeague,
      stabilityByPeriod,
      acceptance: {
        minimumCalibrationSample: STAGE7_MIN_CALIBRATION_SAMPLE,
        minimumRetrospectiveSample: STAGE7_MIN_RETROSPECTIVE_SAMPLE,
        calibrationTolerance: MODEL_VALIDATION_CALIBRATION_TOLERANCE,
        enoughCalibrationData,
        enoughRetrospectiveData,
        preservesBrierAdvantage,
        preservesLogLossAdvantage,
        doesNotDegradeRawBrier,
        doesNotDegradeRawLogLoss,
        calibrationWithinTolerance,
        enoughStabilityCoverage,
      },
    },
    prospectiveHoldout: {
      startsAt: STAGE7_PROSPECTIVE_HOLDOUT_START,
      requiredFixtures: STAGE7_MIN_PROSPECTIVE_HOLDOUT_SAMPLE,
      status: readinessStatus === "SHADOW_READY" ? "PENDING" : "NOT_STARTED",
    },
    promotion: {
      productionValidated: false,
      reason: readinessStatus === "SHADOW_READY"
        ? "Retrospective calibration gate passed. The frozen calibrator must now pass the untouched prospective holdout before any production promotion."
        : "The calibration candidate did not pass the retrospective calibration gate; no production promotion is allowed.",
    },
  };
}

function holdoutMetricInputs(
  rows: readonly Stage7HoldoutFixture[],
  kind: "raw" | "calibrated",
): MulticlassMetricInput[] {
  return rows.map((row) => ({ probabilities: kind === "raw" ? row.raw : row.calibrated, outcome: row.outcome }));
}

export function runStage7ProspectiveHoldout(rows: readonly Stage7HoldoutFixture[]) {
  const eligible = rows
    .filter((row) => row.fixtureDate >= STAGE7_PROSPECTIVE_HOLDOUT_START)
    .sort((a, b) => a.fixtureDate.localeCompare(b.fixtureDate) || a.fixtureId.localeCompare(b.fixtureId));
  const rawMetrics = multiclassMetrics(holdoutMetricInputs(eligible, "raw"));
  const calibratedMetrics = multiclassMetrics(holdoutMetricInputs(eligible, "calibrated"));
  const enoughData = eligible.length >= STAGE7_MIN_PROSPECTIVE_HOLDOUT_SAMPLE;
  const improvesOrPreservesBrier = enoughData && calibratedMetrics.brier <= rawMetrics.brier;
  const improvesOrPreservesLogLoss = enoughData && calibratedMetrics.logLoss <= rawMetrics.logLoss;
  const calibrationWithinTolerance = enoughData
    && calibratedMetrics.maxCalibrationGap <= MODEL_VALIDATION_CALIBRATION_TOLERANCE;

  const byLeague = new Map<string, Stage7HoldoutFixture[]>();
  for (const row of eligible) {
    const group = byLeague.get(row.league) ?? [];
    group.push(row);
    byLeague.set(row.league, group);
  }
  const stabilityByLeague = [...byLeague.entries()]
    .filter(([, group]) => group.length >= 20)
    .map(([key, group]) => ({
      key,
      predictions: group.length,
      metrics: multiclassMetrics(holdoutMetricInputs(group, "calibrated")),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const enoughStabilityCoverage = enoughData && stabilityByLeague.length >= 3;

  const readinessStatus: Stage7Readiness = !enoughData
    ? "PROSPECTIVE_HOLDOUT_PENDING"
    : improvesOrPreservesBrier
      && improvesOrPreservesLogLoss
      && calibrationWithinTolerance
      && enoughStabilityCoverage
      ? "HOLDOUT_PASSED"
      : "HOLDOUT_FAILED";

  return {
    protocolVersion: STAGE7_1X2_HOLDOUT_PROTOCOL,
    marketFamily: "1X2" as const,
    targetArtifact: STAGE7_1X2_TARGET_MODEL,
    calibrationVersion: STAGE7_1X2_CALIBRATION_VERSION,
    readinessStatus,
    prospectiveHoldout: {
      startsAt: STAGE7_PROSPECTIVE_HOLDOUT_START,
      sampleSize: eligible.length,
      requiredFixtures: STAGE7_MIN_PROSPECTIVE_HOLDOUT_SAMPLE,
      firstFixtureDate: eligible[0]?.fixtureDate ?? null,
      lastFixtureDate: eligible[eligible.length - 1]?.fixtureDate ?? null,
      rawMetrics,
      calibratedMetrics,
      stabilityByLeague,
      acceptance: {
        enoughData,
        improvesOrPreservesBrier,
        improvesOrPreservesLogLoss,
        calibrationTolerance: MODEL_VALIDATION_CALIBRATION_TOLERANCE,
        calibrationWithinTolerance,
        enoughStabilityCoverage,
      },
    },
    promotion: {
      productionValidated: false,
      reason: readinessStatus === "HOLDOUT_PASSED"
        ? "Untouched prospective holdout passed. Explicit governed promotion is still required; this job never promotes automatically."
        : readinessStatus === "PROSPECTIVE_HOLDOUT_PENDING"
          ? "Untouched prospective holdout has not reached the minimum sample."
          : "Untouched prospective holdout failed at least one production prerequisite.",
    },
  };
}
