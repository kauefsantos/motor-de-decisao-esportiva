import {
  applyOneXTwoJointCalibration,
  fitOneXTwoJointCalibration,
  type JointCalibrationFamily,
  type OneXTwoJointCalibrationParameters,
} from "../../engine/multiclass-joint-calibration";
import type {
  OneXTwoCalibrationInput,
  OneXTwoProbabilities,
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
import type { Stage7HoldoutFixture, Stage7Readiness } from "./stage7-1x2-calibration";

export const STAGE7C_1X2_CALIBRATION_PROTOCOL = "stage7c-1x2-joint-calibration-v1";
export const STAGE7C_1X2_HOLDOUT_PROTOCOL = "stage7c-1x2-prospective-holdout-v1";
export const STAGE7C_1X2_TARGET_MODEL = STAGE6_GOALS_ELO_ARTIFACT;
export const STAGE7C_1X2_CALIBRATION_VERSION = "joint-logit-v1-fit-through-2026-05-31";
export const STAGE7C_INTERNAL_SELECTION_START = "2026-04-01";
export const STAGE7C_CALIBRATION_END_EXCLUSIVE = "2026-06-01";
export const STAGE7C_RETROSPECTIVE_END_EXCLUSIVE = "2026-09-14";
export const STAGE7C_PROSPECTIVE_HOLDOUT_START = "2026-09-14";
export const STAGE7C_MIN_FIT_SAMPLE = 1000;
export const STAGE7C_MIN_SELECTION_SAMPLE = 300;
export const STAGE7C_MIN_RETROSPECTIVE_SAMPLE = 300;
export const STAGE7C_MIN_PROSPECTIVE_HOLDOUT_SAMPLE = 200;

const FAMILIES: readonly JointCalibrationFamily[] = ["vector_scaling", "dirichlet"];
const LAMBDAS = [0.001, 0.01, 0.05, 0.2] as const;
const BLENDS = [0.25, 0.5, 0.75, 1] as const;

type Stage6Prediction = ReturnType<typeof buildStage6GoalsPredictions>[number];

type CandidateResult = {
  family: JointCalibrationFamily;
  lambda: number;
  blend: number;
  brier: number;
  logLoss: number;
  maxCalibrationGap: number;
  expectedCalibrationError: number;
  preservesBrier: boolean;
  preservesLogLoss: boolean;
  improvesCalibrationGap: boolean;
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

function calibrationInputs(rows: readonly Stage6Prediction[]): OneXTwoCalibrationInput[] {
  return rows.map((row) => ({ probabilities: rawProbabilities(row), outcome: row.outcome1x2 }));
}

function metricInputs(
  rows: readonly Stage6Prediction[],
  kind: "raw" | "baseline" | "calibrated",
  parameters?: OneXTwoJointCalibrationParameters,
): MulticlassMetricInput[] {
  return rows.map((row) => {
    const raw = rawProbabilities(row);
    const probabilities = kind === "raw"
      ? raw
      : kind === "baseline"
        ? baselineProbabilities(row)
        : parameters
          ? applyOneXTwoJointCalibration(raw, parameters)
          : raw;
    return { probabilities, outcome: row.outcome1x2 };
  });
}

function selectHyperparameters(
  fitRows: readonly Stage6Prediction[],
  selectionRows: readonly Stage6Prediction[],
) {
  const selectionRaw = multiclassMetrics(metricInputs(selectionRows, "raw"));
  const fitInputs = calibrationInputs(fitRows);
  const candidates: CandidateResult[] = [];

  for (const family of FAMILIES) {
    for (const lambda of LAMBDAS) {
      const fit = fitOneXTwoJointCalibration(fitInputs, family, lambda);
      for (const blend of BLENDS) {
        const parameters: OneXTwoJointCalibrationParameters = { ...fit.parameters, blend };
        const metrics = multiclassMetrics(metricInputs(selectionRows, "calibrated", parameters));
        candidates.push({
          family,
          lambda,
          blend,
          brier: metrics.brier,
          logLoss: metrics.logLoss,
          maxCalibrationGap: metrics.maxCalibrationGap,
          expectedCalibrationError: metrics.expectedCalibrationError,
          preservesBrier: metrics.brier <= selectionRaw.brier,
          preservesLogLoss: metrics.logLoss <= selectionRaw.logLoss,
          improvesCalibrationGap: metrics.maxCalibrationGap < selectionRaw.maxCalibrationGap,
        });
      }
    }
  }

  const eligible = candidates.filter((candidate) =>
    candidate.preservesBrier && candidate.preservesLogLoss && candidate.improvesCalibrationGap,
  );
  const pool = eligible.length > 0 ? eligible : candidates;
  const selected = [...pool].sort((a, b) =>
    a.maxCalibrationGap - b.maxCalibrationGap
    || a.logLoss - b.logLoss
    || a.brier - b.brier
    || a.expectedCalibrationError - b.expectedCalibrationError
    || a.family.localeCompare(b.family)
    || a.lambda - b.lambda
    || a.blend - b.blend,
  )[0];
  if (!selected) throw new Error("Stage 7C could not select a joint multiclass calibration candidate.");

  return {
    selected,
    selectionRaw,
    selectionCandidates: [...candidates].sort((a, b) =>
      a.maxCalibrationGap - b.maxCalibrationGap || a.logLoss - b.logLoss,
    ),
    hadStrictlyEligibleCandidate: eligible.length > 0,
  };
}

function stability(
  rows: readonly Stage6Prediction[],
  parameters: OneXTwoJointCalibrationParameters,
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
      const raw = multiclassMetrics(metricInputs(group, "raw"));
      const calibrated = multiclassMetrics(metricInputs(group, "calibrated", parameters));
      return {
        key,
        predictions: group.length,
        rawBrier: raw.brier,
        calibratedBrier: calibrated.brier,
        rawLogLoss: raw.logLoss,
        calibratedLogLoss: calibrated.logLoss,
        maxCalibrationGap: calibrated.maxCalibrationGap,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function runStage7COneXTwoCalibration(sourceRows: readonly Stage6GoalRow[]) {
  const predictions = buildStage6GoalsPredictions(sourceRows, STAGE7C_1X2_TARGET_MODEL);
  const fitRows = predictions.filter((row) => row.date < STAGE7C_INTERNAL_SELECTION_START);
  const selectionRows = predictions.filter(
    (row) => row.date >= STAGE7C_INTERNAL_SELECTION_START && row.date < STAGE7C_CALIBRATION_END_EXCLUSIVE,
  );
  const fullCalibrationRows = predictions.filter((row) => row.date < STAGE7C_CALIBRATION_END_EXCLUSIVE);
  const retrospectiveRows = predictions.filter(
    (row) => row.date >= STAGE7C_CALIBRATION_END_EXCLUSIVE && row.date < STAGE7C_RETROSPECTIVE_END_EXCLUSIVE,
  );

  if (fitRows.length === 0 || selectionRows.length === 0 || fullCalibrationRows.length === 0) {
    return {
      protocolVersion: STAGE7C_1X2_CALIBRATION_PROTOCOL,
      marketFamily: "1X2" as const,
      targetArtifact: STAGE7C_1X2_TARGET_MODEL,
      calibrationVersion: STAGE7C_1X2_CALIBRATION_VERSION,
      readinessStatus: "INSUFFICIENT_DATA" as Stage7Readiness,
      calibrationFit: null,
      retrospective: null,
      prospectiveHoldout: {
        startsAt: STAGE7C_PROSPECTIVE_HOLDOUT_START,
        requiredFixtures: STAGE7C_MIN_PROSPECTIVE_HOLDOUT_SAMPLE,
        status: "NOT_STARTED" as const,
      },
      promotion: { productionValidated: false, reason: "Stage 7C fitting or internal selection window is empty." },
    };
  }

  const selection = selectHyperparameters(fitRows, selectionRows);
  const refit = fitOneXTwoJointCalibration(
    calibrationInputs(fullCalibrationRows),
    selection.selected.family,
    selection.selected.lambda,
  );
  const parameters: OneXTwoJointCalibrationParameters = {
    ...refit.parameters,
    blend: selection.selected.blend,
  };

  const fitRawMetrics = multiclassMetrics(metricInputs(fullCalibrationRows, "raw"));
  const fitCalibratedMetrics = multiclassMetrics(metricInputs(fullCalibrationRows, "calibrated", parameters));
  const shadowRawMetrics = multiclassMetrics(metricInputs(retrospectiveRows, "raw"));
  const shadowCalibratedMetrics = multiclassMetrics(metricInputs(retrospectiveRows, "calibrated", parameters));
  const shadowBaselineMetrics = multiclassMetrics(metricInputs(retrospectiveRows, "baseline"));
  const stabilityByLeague = stability(retrospectiveRows, parameters, (row) => row.league, 30);
  const stabilityByPeriod = stability(retrospectiveRows, parameters, (row) => row.date.slice(0, 7), 20);

  const enoughFitData = fitRows.length >= STAGE7C_MIN_FIT_SAMPLE;
  const enoughSelectionData = selectionRows.length >= STAGE7C_MIN_SELECTION_SAMPLE;
  const enoughRetrospectiveData = retrospectiveRows.length >= STAGE7C_MIN_RETROSPECTIVE_SAMPLE;
  const internalSelectionPassed = selection.hadStrictlyEligibleCandidate;
  const preservesBrierAdvantage = enoughRetrospectiveData && shadowCalibratedMetrics.brier < shadowBaselineMetrics.brier;
  const preservesLogLossAdvantage = enoughRetrospectiveData && shadowCalibratedMetrics.logLoss < shadowBaselineMetrics.logLoss;
  const doesNotDegradeRawBrier = enoughRetrospectiveData && shadowCalibratedMetrics.brier <= shadowRawMetrics.brier;
  const doesNotDegradeRawLogLoss = enoughRetrospectiveData && shadowCalibratedMetrics.logLoss <= shadowRawMetrics.logLoss;
  const calibrationWithinTolerance = enoughRetrospectiveData
    && shadowCalibratedMetrics.maxCalibrationGap <= MODEL_VALIDATION_CALIBRATION_TOLERANCE;
  const enoughStabilityCoverage = stabilityByLeague.length >= 3 && stabilityByPeriod.length >= 3;

  const readinessStatus: Stage7Readiness = !enoughFitData || !enoughSelectionData || !enoughRetrospectiveData
    ? "INSUFFICIENT_DATA"
    : internalSelectionPassed
      && preservesBrierAdvantage
      && preservesLogLossAdvantage
      && doesNotDegradeRawBrier
      && doesNotDegradeRawLogLoss
      && calibrationWithinTolerance
      && enoughStabilityCoverage
      ? "SHADOW_READY"
      : "CALIBRATION_REJECTED";

  return {
    protocolVersion: STAGE7C_1X2_CALIBRATION_PROTOCOL,
    marketFamily: "1X2" as const,
    targetArtifact: STAGE7C_1X2_TARGET_MODEL,
    calibrationVersion: STAGE7C_1X2_CALIBRATION_VERSION,
    readinessStatus,
    windows: {
      internalFit: {
        firstDate: fitRows[0]?.date ?? null,
        lastDate: fitRows[fitRows.length - 1]?.date ?? null,
        endExclusive: STAGE7C_INTERNAL_SELECTION_START,
      },
      internalSelection: {
        firstDate: selectionRows[0]?.date ?? null,
        lastDate: selectionRows[selectionRows.length - 1]?.date ?? null,
        endExclusive: STAGE7C_CALIBRATION_END_EXCLUSIVE,
      },
      retrospectiveShadow: {
        firstDate: retrospectiveRows[0]?.date ?? null,
        lastDate: retrospectiveRows[retrospectiveRows.length - 1]?.date ?? null,
        endExclusive: STAGE7C_RETROSPECTIVE_END_EXCLUSIVE,
        isFinalHoldout: false,
      },
    },
    calibrationFit: {
      method: "joint_multiclass_logit" as const,
      parameters,
      sampleSize: fullCalibrationRows.length,
      internalFitSampleSize: fitRows.length,
      internalSelectionSampleSize: selectionRows.length,
      selectedHyperparameters: selection.selected,
      hadStrictlyEligibleCandidate: selection.hadStrictlyEligibleCandidate,
      selectionRawMetrics: selection.selectionRaw,
      selectionLeaderboard: selection.selectionCandidates,
      rawMetrics: fitRawMetrics,
      calibratedMetrics: fitCalibratedMetrics,
      refitLogLossBefore: refit.logLossBefore,
      refitLogLossAfter: refit.logLossAfter,
    },
    retrospective: {
      sampleSize: retrospectiveRows.length,
      rawMetrics: shadowRawMetrics,
      calibratedMetrics: shadowCalibratedMetrics,
      baselineMetrics: shadowBaselineMetrics,
      stabilityByLeague,
      stabilityByPeriod,
      acceptance: {
        minimumFitSample: STAGE7C_MIN_FIT_SAMPLE,
        minimumSelectionSample: STAGE7C_MIN_SELECTION_SAMPLE,
        minimumRetrospectiveSample: STAGE7C_MIN_RETROSPECTIVE_SAMPLE,
        calibrationTolerance: MODEL_VALIDATION_CALIBRATION_TOLERANCE,
        enoughFitData,
        enoughSelectionData,
        enoughRetrospectiveData,
        internalSelectionPassed,
        preservesBrierAdvantage,
        preservesLogLossAdvantage,
        doesNotDegradeRawBrier,
        doesNotDegradeRawLogLoss,
        calibrationWithinTolerance,
        enoughStabilityCoverage,
      },
    },
    prospectiveHoldout: {
      startsAt: STAGE7C_PROSPECTIVE_HOLDOUT_START,
      requiredFixtures: STAGE7C_MIN_PROSPECTIVE_HOLDOUT_SAMPLE,
      status: readinessStatus === "SHADOW_READY" ? "PENDING" as const : "NOT_STARTED" as const,
    },
    promotion: {
      productionValidated: false,
      reason: readinessStatus === "SHADOW_READY"
        ? "Stage 7C retrospective gate passed. The frozen joint calibrator must pass the untouched prospective holdout before any governed production promotion."
        : "Stage 7C joint multiclass calibration did not pass every retrospective prerequisite; no production promotion is allowed.",
    },
  };
}

function holdoutMetricInputs(
  rows: readonly Stage7HoldoutFixture[],
  kind: "raw" | "calibrated",
): MulticlassMetricInput[] {
  return rows.map((row) => ({ probabilities: kind === "raw" ? row.raw : row.calibrated, outcome: row.outcome }));
}

export function runStage7CProspectiveHoldout(rows: readonly Stage7HoldoutFixture[]) {
  const eligible = rows
    .filter((row) => row.fixtureDate >= STAGE7C_PROSPECTIVE_HOLDOUT_START)
    .sort((a, b) => a.fixtureDate.localeCompare(b.fixtureDate) || a.fixtureId.localeCompare(b.fixtureId));
  const rawMetrics = multiclassMetrics(holdoutMetricInputs(eligible, "raw"));
  const calibratedMetrics = multiclassMetrics(holdoutMetricInputs(eligible, "calibrated"));
  const enoughData = eligible.length >= STAGE7C_MIN_PROSPECTIVE_HOLDOUT_SAMPLE;
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
    protocolVersion: STAGE7C_1X2_HOLDOUT_PROTOCOL,
    marketFamily: "1X2" as const,
    targetArtifact: STAGE7C_1X2_TARGET_MODEL,
    calibrationVersion: STAGE7C_1X2_CALIBRATION_VERSION,
    readinessStatus,
    prospectiveHoldout: {
      startsAt: STAGE7C_PROSPECTIVE_HOLDOUT_START,
      sampleSize: eligible.length,
      requiredFixtures: STAGE7C_MIN_PROSPECTIVE_HOLDOUT_SAMPLE,
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
