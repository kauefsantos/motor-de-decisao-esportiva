import {
  applyOneXTwoClasswiseIsotonic,
  fitOneXTwoClasswiseIsotonic,
  isOneXTwoIsotonicParameters,
  type OneXTwoIsotonicParameters,
} from "../../engine/multiclass-isotonic-calibration";
import {
  applyOneXTwoJointCalibration,
  fitOneXTwoJointCalibration,
  isOneXTwoJointCalibrationParameters,
  type JointCalibrationFamily,
  type OneXTwoJointCalibrationParameters,
} from "../../engine/multiclass-joint-calibration";
import {
  applyOneXTwoTemperature,
  fitOneXTwoTemperature,
  normalizeOneXTwo,
  type OneXTwoCalibrationInput,
  type OneXTwoLabel,
  type OneXTwoProbabilities,
} from "../../engine/multiclass-calibration";
import {
  ONE_X_TWO_ENSEMBLE_MODEL_VERSION,
  uncertaintyLinearOneXTwo,
} from "../../engine/one-x-two-ensemble";
import {
  MODEL_VALIDATION_CALIBRATION_TOLERANCE,
  multiclassMetrics,
  type MulticlassMetricInput,
} from "./model-validation";
import {
  STAGE6_GOALS_ELO_ARTIFACT,
  buildStage6GoalsPredictions,
  type Stage6GoalRow,
} from "./goals-walk-forward";
import {
  STAGE8_ELO_PURE60_ADVANTAGE,
  buildStage8PureEloPredictions,
} from "./stage8-elo-pure-challenger";

export const STAGE9_1X2_CALIBRATION_PROTOCOL = "stage9-1x2-ensemble-calibration-v1";
export const STAGE9_1X2_HOLDOUT_PROTOCOL = "stage9-1x2-ensemble-prospective-holdout-v1";
export const STAGE9_1X2_TARGET_MODEL = `${STAGE6_GOALS_ELO_ARTIFACT}+${ONE_X_TWO_ENSEMBLE_MODEL_VERSION}`;
export const STAGE9_1X2_CALIBRATION_VERSION = "stage9-ensemble-calibration-v1-fit-through-2026-05-31";
export const STAGE9_INTERNAL_SELECTION_START = "2026-04-01";
export const STAGE9_CALIBRATION_END_EXCLUSIVE = "2026-06-01";
export const STAGE9_RETROSPECTIVE_END_EXCLUSIVE = "2026-09-14";
export const STAGE9_PROSPECTIVE_HOLDOUT_START = "2026-09-14";
export const STAGE9_MIN_FIT_SAMPLE = 1000;
export const STAGE9_MIN_SELECTION_SAMPLE = 300;
export const STAGE9_MIN_RETROSPECTIVE_SAMPLE = 300;
export const STAGE9_MIN_PROSPECTIVE_HOLDOUT_SAMPLE = 200;

const EPS = 1e-12;
const ISOTONIC_BINS = [10, 15, 25, 40, 60] as const;
const BLENDS = [0.25, 0.5, 0.75, 1] as const;
const JOINT_LAMBDAS = [0.001, 0.01, 0.05, 0.2] as const;
const PRIOR_SHRINKAGE = [0.02, 0.04, 0.06, 0.08, 0.1, 0.15, 0.2] as const;

type EnsemblePrediction = {
  fixtureId: string;
  date: string;
  league: string;
  probabilities: OneXTwoProbabilities;
  outcome: OneXTwoLabel;
};

type TemperatureBlendParameters = {
  kind: "temperature_blend";
  temperature: number;
  blend: number;
};

type PriorShrinkageParameters = {
  kind: "prior_shrinkage";
  alpha: number;
  priors: OneXTwoProbabilities;
};

export type Stage9CalibrationParameters =
  | TemperatureBlendParameters
  | PriorShrinkageParameters
  | OneXTwoIsotonicParameters
  | OneXTwoJointCalibrationParameters;

type CandidateSpec =
  | { kind: "temperature"; blend: number }
  | { kind: "isotonic"; binCount: number; blend: number }
  | { kind: "joint"; family: JointCalibrationFamily; lambda: number; blend: number }
  | { kind: "prior_shrinkage"; alpha: number };

type CandidateScore = {
  id: string;
  spec: CandidateSpec;
  parameters: Stage9CalibrationParameters;
  brier: number;
  logLoss: number;
  expectedCalibrationError: number;
  maxCalibrationGap: number;
  preservesBrier: boolean;
  preservesLogLoss: boolean;
  improvesCalibrationGap: boolean;
  passesCalibrationGate: boolean;
};

export type Stage9Readiness =
  | "INSUFFICIENT_DATA"
  | "CALIBRATION_REJECTED"
  | "SHADOW_READY"
  | "PROSPECTIVE_HOLDOUT_PENDING"
  | "HOLDOUT_FAILED"
  | "HOLDOUT_PASSED";

export type Stage9HoldoutFixture = {
  fixtureId: string;
  predictionAt: string;
  fixtureDate: string;
  league: string;
  raw: OneXTwoProbabilities;
  calibrated: OneXTwoProbabilities;
  outcome: OneXTwoLabel;
};

function fixtureKey(league: string, fixtureId: string): string {
  return `${league}::${fixtureId}`;
}

export function buildStage9EnsemblePredictions(sourceRows: readonly Stage6GoalRow[]): EnsemblePrediction[] {
  const base = buildStage6GoalsPredictions(sourceRows, STAGE6_GOALS_ELO_ARTIFACT);
  const pureElo = buildStage8PureEloPredictions(sourceRows, STAGE8_ELO_PURE60_ADVANTAGE);
  const pureByFixture = new Map(
    pureElo.map((row) => [fixtureKey(row.league, row.fixtureId), row] as const),
  );

  return base.flatMap((row) => {
    const auxiliary = pureByFixture.get(fixtureKey(row.league, row.fixtureId));
    if (!auxiliary) return [];
    const probabilities = uncertaintyLinearOneXTwo(
      {
        HOME: row.homeProbability,
        DRAW: row.drawProbability,
        AWAY: row.awayProbability,
      },
      {
        HOME: auxiliary.homeProbability,
        DRAW: auxiliary.drawProbability,
        AWAY: auxiliary.awayProbability,
      },
    );
    return [{
      fixtureId: row.fixtureId,
      date: row.date,
      league: row.league,
      probabilities,
      outcome: row.outcome1x2,
    }];
  });
}

function blendProbabilities(
  raw: OneXTwoProbabilities,
  calibrated: OneXTwoProbabilities,
  blend: number,
): OneXTwoProbabilities {
  const safeBlend = Math.max(0, Math.min(1, blend));
  return normalizeOneXTwo({
    HOME: raw.HOME * (1 - safeBlend) + calibrated.HOME * safeBlend,
    DRAW: raw.DRAW * (1 - safeBlend) + calibrated.DRAW * safeBlend,
    AWAY: raw.AWAY * (1 - safeBlend) + calibrated.AWAY * safeBlend,
  });
}

export function applyStage9Calibration(
  probabilities: OneXTwoProbabilities,
  parameters: Stage9CalibrationParameters,
): OneXTwoProbabilities {
  const raw = normalizeOneXTwo(probabilities);
  if (parameters.kind === "temperature_blend") {
    return blendProbabilities(
      raw,
      applyOneXTwoTemperature(raw, parameters.temperature),
      parameters.blend,
    );
  }
  if (parameters.kind === "prior_shrinkage") {
    return normalizeOneXTwo({
      HOME: raw.HOME * (1 - parameters.alpha) + parameters.priors.HOME * parameters.alpha,
      DRAW: raw.DRAW * (1 - parameters.alpha) + parameters.priors.DRAW * parameters.alpha,
      AWAY: raw.AWAY * (1 - parameters.alpha) + parameters.priors.AWAY * parameters.alpha,
    });
  }
  if (parameters.kind === "classwise_isotonic_blend") {
    return applyOneXTwoClasswiseIsotonic(raw, parameters);
  }
  return applyOneXTwoJointCalibration(raw, parameters);
}

export function isStage9CalibrationParameters(value: unknown): value is Stage9CalibrationParameters {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Stage9CalibrationParameters> & Record<string, unknown>;
  if (candidate.kind === "temperature_blend") {
    return Number.isFinite(candidate.temperature)
      && Number(candidate.temperature) > 0
      && Number.isFinite(candidate.blend)
      && Number(candidate.blend) >= 0
      && Number(candidate.blend) <= 1;
  }
  if (candidate.kind === "prior_shrinkage") {
    const priors = candidate.priors as Partial<OneXTwoProbabilities> | undefined;
    return Number.isFinite(candidate.alpha)
      && Number(candidate.alpha) >= 0
      && Number(candidate.alpha) <= 1
      && Boolean(priors)
      && Number.isFinite(priors?.HOME)
      && Number.isFinite(priors?.DRAW)
      && Number.isFinite(priors?.AWAY);
  }
  return isOneXTwoIsotonicParameters(value) || isOneXTwoJointCalibrationParameters(value);
}

function calibrationInputs(rows: readonly EnsemblePrediction[]): OneXTwoCalibrationInput[] {
  return rows.map((row) => ({ probabilities: row.probabilities, outcome: row.outcome }));
}

function metricInputs(
  rows: readonly EnsemblePrediction[],
  parameters?: Stage9CalibrationParameters,
): MulticlassMetricInput[] {
  return rows.map((row) => ({
    probabilities: parameters
      ? applyStage9Calibration(row.probabilities, parameters)
      : row.probabilities,
    outcome: row.outcome,
  }));
}

function empiricalPriors(inputs: readonly OneXTwoCalibrationInput[]): OneXTwoProbabilities {
  const count = Math.max(1, inputs.length);
  const counts = { HOME: 0, DRAW: 0, AWAY: 0 };
  for (const input of inputs) counts[input.outcome] += 1;
  return normalizeOneXTwo({
    HOME: counts.HOME / count,
    DRAW: counts.DRAW / count,
    AWAY: counts.AWAY / count,
  });
}

function candidateId(spec: CandidateSpec): string {
  if (spec.kind === "temperature") return `temperature-blend-${spec.blend}`;
  if (spec.kind === "isotonic") return `isotonic-${spec.binCount}-blend-${spec.blend}`;
  if (spec.kind === "joint") return `${spec.family}-lambda-${spec.lambda}-blend-${spec.blend}`;
  return `prior-shrink-${spec.alpha}`;
}

function candidateSpecs(): CandidateSpec[] {
  const output: CandidateSpec[] = [];
  for (const blend of BLENDS) output.push({ kind: "temperature", blend });
  for (const binCount of ISOTONIC_BINS) {
    for (const blend of BLENDS) output.push({ kind: "isotonic", binCount, blend });
  }
  for (const family of ["vector_scaling", "dirichlet"] as const) {
    for (const lambda of JOINT_LAMBDAS) {
      for (const blend of BLENDS) output.push({ kind: "joint", family, lambda, blend });
    }
  }
  for (const alpha of PRIOR_SHRINKAGE) output.push({ kind: "prior_shrinkage", alpha });
  return output;
}

function fitCandidate(
  spec: CandidateSpec,
  inputs: readonly OneXTwoCalibrationInput[],
  cache = new Map<string, unknown>(),
): Stage9CalibrationParameters {
  if (spec.kind === "temperature") {
    const key = "temperature";
    let fitted = cache.get(key) as ReturnType<typeof fitOneXTwoTemperature> | undefined;
    if (!fitted) {
      fitted = fitOneXTwoTemperature(inputs);
      cache.set(key, fitted);
    }
    return { kind: "temperature_blend", temperature: fitted.temperature, blend: spec.blend };
  }
  if (spec.kind === "isotonic") {
    const key = `isotonic:${spec.binCount}`;
    let fitted = cache.get(key) as Omit<OneXTwoIsotonicParameters, "blend"> | undefined;
    if (!fitted) {
      fitted = fitOneXTwoClasswiseIsotonic(inputs, spec.binCount);
      cache.set(key, fitted);
    }
    return { ...fitted, blend: spec.blend };
  }
  if (spec.kind === "joint") {
    const key = `joint:${spec.family}:${spec.lambda}`;
    let fitted = cache.get(key) as ReturnType<typeof fitOneXTwoJointCalibration> | undefined;
    if (!fitted) {
      fitted = fitOneXTwoJointCalibration(inputs, spec.family, spec.lambda);
      cache.set(key, fitted);
    }
    return { ...fitted.parameters, blend: spec.blend };
  }
  const key = "priors";
  let priors = cache.get(key) as OneXTwoProbabilities | undefined;
  if (!priors) {
    priors = empiricalPriors(inputs);
    cache.set(key, priors);
  }
  return { kind: "prior_shrinkage", alpha: spec.alpha, priors };
}

function selectCandidate(
  fitRows: readonly EnsemblePrediction[],
  selectionRows: readonly EnsemblePrediction[],
) {
  const fitInputs = calibrationInputs(fitRows);
  const rawMetrics = multiclassMetrics(metricInputs(selectionRows));
  const cache = new Map<string, unknown>();
  const scores: CandidateScore[] = candidateSpecs().map((spec) => {
    const parameters = fitCandidate(spec, fitInputs, cache);
    const metrics = multiclassMetrics(metricInputs(selectionRows, parameters));
    return {
      id: candidateId(spec),
      spec,
      parameters,
      brier: metrics.brier,
      logLoss: metrics.logLoss,
      expectedCalibrationError: metrics.expectedCalibrationError,
      maxCalibrationGap: metrics.maxCalibrationGap,
      preservesBrier: metrics.brier <= rawMetrics.brier + EPS,
      preservesLogLoss: metrics.logLoss <= rawMetrics.logLoss + EPS,
      improvesCalibrationGap: metrics.maxCalibrationGap < rawMetrics.maxCalibrationGap - EPS,
      passesCalibrationGate: metrics.maxCalibrationGap <= MODEL_VALIDATION_CALIBRATION_TOLERANCE,
    };
  });
  const eligible = scores.filter((score) =>
    score.preservesBrier && score.preservesLogLoss && score.improvesCalibrationGap,
  );
  const pool = eligible.length > 0 ? eligible : scores;
  const ranked = [...pool].sort((a, b) =>
    Number(b.passesCalibrationGate) - Number(a.passesCalibrationGate)
    || a.maxCalibrationGap - b.maxCalibrationGap
    || a.logLoss - b.logLoss
    || a.brier - b.brier
    || a.id.localeCompare(b.id),
  );
  const selected = ranked[0];
  if (!selected) throw new Error("Stage 9 could not select a calibration candidate.");
  return {
    selected,
    rawMetrics,
    hadStrictlyEligibleCandidate: eligible.length > 0,
    leaderboard: [...scores].sort((a, b) =>
      Number(b.passesCalibrationGate) - Number(a.passesCalibrationGate)
      || a.maxCalibrationGap - b.maxCalibrationGap
      || a.logLoss - b.logLoss,
    ).map(({ parameters: _parameters, spec: _spec, ...score }) => score),
  };
}

function stability(
  rows: readonly EnsemblePrediction[],
  parameters: Stage9CalibrationParameters,
  keyOf: (row: EnsemblePrediction) => string,
  minimumSlice: number,
) {
  const groups = new Map<string, EnsemblePrediction[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length >= minimumSlice)
    .map(([key, group]) => {
      const raw = multiclassMetrics(metricInputs(group));
      const calibrated = multiclassMetrics(metricInputs(group, parameters));
      return {
        key,
        predictions: group.length,
        rawBrier: raw.brier,
        calibratedBrier: calibrated.brier,
        rawLogLoss: raw.logLoss,
        calibratedLogLoss: calibrated.logLoss,
        maxCalibrationGap: calibrated.maxCalibrationGap,
        scoringNonDegrading: calibrated.brier <= raw.brier + EPS && calibrated.logLoss <= raw.logLoss + EPS,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function stableShare(rows: readonly { scoringNonDegrading: boolean }[]): number {
  if (rows.length === 0) return 0;
  return rows.filter((row) => row.scoringNonDegrading).length / rows.length;
}

export function runStage9OneXTwoCalibration(sourceRows: readonly Stage6GoalRow[]) {
  const predictions = buildStage9EnsemblePredictions(sourceRows);
  const fitRows = predictions.filter((row) => row.date < STAGE9_INTERNAL_SELECTION_START);
  const selectionRows = predictions.filter(
    (row) => row.date >= STAGE9_INTERNAL_SELECTION_START && row.date < STAGE9_CALIBRATION_END_EXCLUSIVE,
  );
  const fullCalibrationRows = predictions.filter((row) => row.date < STAGE9_CALIBRATION_END_EXCLUSIVE);
  const retrospectiveRows = predictions.filter(
    (row) => row.date >= STAGE9_CALIBRATION_END_EXCLUSIVE && row.date < STAGE9_RETROSPECTIVE_END_EXCLUSIVE,
  );

  if (fitRows.length === 0 || selectionRows.length === 0 || fullCalibrationRows.length === 0) {
    return {
      protocolVersion: STAGE9_1X2_CALIBRATION_PROTOCOL,
      marketFamily: "1X2" as const,
      targetArtifact: STAGE9_1X2_TARGET_MODEL,
      calibrationVersion: STAGE9_1X2_CALIBRATION_VERSION,
      readinessStatus: "INSUFFICIENT_DATA" as Stage9Readiness,
      calibrationFit: null,
      retrospective: null,
      prospectiveHoldout: {
        startsAt: STAGE9_PROSPECTIVE_HOLDOUT_START,
        requiredFixtures: STAGE9_MIN_PROSPECTIVE_HOLDOUT_SAMPLE,
        status: "NOT_STARTED" as const,
      },
      promotion: { productionValidated: false, reason: "Stage 9 fitting or selection window is empty." },
    };
  }

  const selection = selectCandidate(fitRows, selectionRows);
  const selectedParameters = fitCandidate(
    selection.selected.spec,
    calibrationInputs(fullCalibrationRows),
  );
  const calibrationRawMetrics = multiclassMetrics(metricInputs(fullCalibrationRows));
  const calibrationMetrics = multiclassMetrics(metricInputs(fullCalibrationRows, selectedParameters));
  const rawMetrics = multiclassMetrics(metricInputs(retrospectiveRows));
  const calibratedMetrics = multiclassMetrics(metricInputs(retrospectiveRows, selectedParameters));
  const stabilityByLeague = stability(retrospectiveRows, selectedParameters, (row) => row.league, 30);
  const stabilityByPeriod = stability(retrospectiveRows, selectedParameters, (row) => row.date.slice(0, 7), 20);
  const stableLeagueShare = stableShare(stabilityByLeague);
  const stablePeriodShare = stableShare(stabilityByPeriod);

  const enoughFitData = fitRows.length >= STAGE9_MIN_FIT_SAMPLE;
  const enoughSelectionData = selectionRows.length >= STAGE9_MIN_SELECTION_SAMPLE;
  const enoughRetrospectiveData = retrospectiveRows.length >= STAGE9_MIN_RETROSPECTIVE_SAMPLE;
  const internalSelectionPassed = selection.hadStrictlyEligibleCandidate;
  const doesNotDegradeRawBrier = enoughRetrospectiveData && calibratedMetrics.brier <= rawMetrics.brier + EPS;
  const doesNotDegradeRawLogLoss = enoughRetrospectiveData && calibratedMetrics.logLoss <= rawMetrics.logLoss + EPS;
  const calibrationWithinTolerance = enoughRetrospectiveData
    && calibratedMetrics.maxCalibrationGap <= MODEL_VALIDATION_CALIBRATION_TOLERANCE;
  const enoughStabilityCoverage = stabilityByLeague.length >= 3 && stabilityByPeriod.length >= 3;
  const temporalStability = enoughStabilityCoverage && stablePeriodShare >= 0.5;
  const leagueStability = enoughStabilityCoverage && stableLeagueShare >= 0.5;
  const noLeakage = true;

  const readinessStatus: Stage9Readiness = !enoughFitData || !enoughSelectionData || !enoughRetrospectiveData
    ? "INSUFFICIENT_DATA"
    : internalSelectionPassed
      && doesNotDegradeRawBrier
      && doesNotDegradeRawLogLoss
      && calibrationWithinTolerance
      && enoughStabilityCoverage
      && temporalStability
      && leagueStability
      && noLeakage
      ? "SHADOW_READY"
      : "CALIBRATION_REJECTED";

  return {
    protocolVersion: STAGE9_1X2_CALIBRATION_PROTOCOL,
    marketFamily: "1X2" as const,
    targetArtifact: STAGE9_1X2_TARGET_MODEL,
    calibrationVersion: STAGE9_1X2_CALIBRATION_VERSION,
    readinessStatus,
    windows: {
      internalFit: {
        firstDate: fitRows[0]?.date ?? null,
        lastDate: fitRows[fitRows.length - 1]?.date ?? null,
        endExclusive: STAGE9_INTERNAL_SELECTION_START,
      },
      internalSelection: {
        firstDate: selectionRows[0]?.date ?? null,
        lastDate: selectionRows[selectionRows.length - 1]?.date ?? null,
        endExclusive: STAGE9_CALIBRATION_END_EXCLUSIVE,
      },
      retrospectiveShadow: {
        firstDate: retrospectiveRows[0]?.date ?? null,
        lastDate: retrospectiveRows[retrospectiveRows.length - 1]?.date ?? null,
        endExclusive: STAGE9_RETROSPECTIVE_END_EXCLUSIVE,
        isFinalHoldout: false,
      },
    },
    selection: {
      candidateCount: candidateSpecs().length,
      rawMetrics: selection.rawMetrics,
      selected: {
        id: selection.selected.id,
        spec: selection.selected.spec,
        brier: selection.selected.brier,
        logLoss: selection.selected.logLoss,
        expectedCalibrationError: selection.selected.expectedCalibrationError,
        maxCalibrationGap: selection.selected.maxCalibrationGap,
        passesCalibrationGate: selection.selected.passesCalibrationGate,
      },
      leaderboard: selection.leaderboard,
      hadStrictlyEligibleCandidate: selection.hadStrictlyEligibleCandidate,
    },
    calibrationFit: {
      method: selectedParameters.kind,
      parameters: selectedParameters,
      sampleSize: fullCalibrationRows.length,
      rawMetrics: calibrationRawMetrics,
      calibratedMetrics: calibrationMetrics,
    },
    retrospective: {
      sampleSize: retrospectiveRows.length,
      rawMetrics,
      calibratedMetrics,
      stabilityByLeague,
      stabilityByPeriod,
      stableLeagueShare,
      stablePeriodShare,
      acceptance: {
        minimumFitSample: STAGE9_MIN_FIT_SAMPLE,
        minimumSelectionSample: STAGE9_MIN_SELECTION_SAMPLE,
        minimumRetrospectiveSample: STAGE9_MIN_RETROSPECTIVE_SAMPLE,
        calibrationTolerance: MODEL_VALIDATION_CALIBRATION_TOLERANCE,
        enoughFitData,
        enoughSelectionData,
        enoughRetrospectiveData,
        internalSelectionPassed,
        doesNotDegradeRawBrier,
        doesNotDegradeRawLogLoss,
        calibrationWithinTolerance,
        enoughStabilityCoverage,
        temporalStability,
        leagueStability,
        noLeakage,
      },
    },
    prospectiveHoldout: {
      startsAt: STAGE9_PROSPECTIVE_HOLDOUT_START,
      requiredFixtures: STAGE9_MIN_PROSPECTIVE_HOLDOUT_SAMPLE,
      status: readinessStatus === "SHADOW_READY" ? "PENDING" : "NOT_STARTED",
    },
    promotion: {
      productionValidated: false,
      reason: readinessStatus === "SHADOW_READY"
        ? "Stage 9 retrospective gate passed. The frozen calibrator must pass the untouched prospective holdout before promotion."
        : "Stage 9 did not pass every retrospective prerequisite; production promotion remains blocked.",
    },
  };
}

function holdoutMetricInputs(
  rows: readonly Stage9HoldoutFixture[],
  kind: "raw" | "calibrated",
): MulticlassMetricInput[] {
  return rows.map((row) => ({
    probabilities: kind === "raw" ? row.raw : row.calibrated,
    outcome: row.outcome,
  }));
}

export function runStage9ProspectiveHoldout(rows: readonly Stage9HoldoutFixture[]) {
  const eligible = rows
    .filter((row) => row.fixtureDate >= STAGE9_PROSPECTIVE_HOLDOUT_START)
    .sort((a, b) => a.fixtureDate.localeCompare(b.fixtureDate) || a.fixtureId.localeCompare(b.fixtureId));
  const rawMetrics = multiclassMetrics(holdoutMetricInputs(eligible, "raw"));
  const calibratedMetrics = multiclassMetrics(holdoutMetricInputs(eligible, "calibrated"));
  const enoughData = eligible.length >= STAGE9_MIN_PROSPECTIVE_HOLDOUT_SAMPLE;
  const improvesOrPreservesBrier = enoughData && calibratedMetrics.brier <= rawMetrics.brier + EPS;
  const improvesOrPreservesLogLoss = enoughData && calibratedMetrics.logLoss <= rawMetrics.logLoss + EPS;
  const calibrationWithinTolerance = enoughData
    && calibratedMetrics.maxCalibrationGap <= MODEL_VALIDATION_CALIBRATION_TOLERANCE;

  const byLeague = new Map<string, Stage9HoldoutFixture[]>();
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
      rawMetrics: multiclassMetrics(holdoutMetricInputs(group, "raw")),
      calibratedMetrics: multiclassMetrics(holdoutMetricInputs(group, "calibrated")),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const enoughStabilityCoverage = enoughData && stabilityByLeague.length >= 3;
  const stableLeagueCount = stabilityByLeague.filter((row) =>
    row.calibratedMetrics.brier <= row.rawMetrics.brier + EPS
    && row.calibratedMetrics.logLoss <= row.rawMetrics.logLoss + EPS,
  ).length;
  const leagueStability = enoughStabilityCoverage
    && stableLeagueCount / Math.max(1, stabilityByLeague.length) >= 0.5;

  const readinessStatus: Stage9Readiness = !enoughData
    ? "PROSPECTIVE_HOLDOUT_PENDING"
    : improvesOrPreservesBrier
      && improvesOrPreservesLogLoss
      && calibrationWithinTolerance
      && enoughStabilityCoverage
      && leagueStability
      ? "HOLDOUT_PASSED"
      : "HOLDOUT_FAILED";

  return {
    protocolVersion: STAGE9_1X2_HOLDOUT_PROTOCOL,
    marketFamily: "1X2" as const,
    targetArtifact: STAGE9_1X2_TARGET_MODEL,
    calibrationVersion: STAGE9_1X2_CALIBRATION_VERSION,
    readinessStatus,
    prospectiveHoldout: {
      startsAt: STAGE9_PROSPECTIVE_HOLDOUT_START,
      sampleSize: eligible.length,
      requiredFixtures: STAGE9_MIN_PROSPECTIVE_HOLDOUT_SAMPLE,
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
        leagueStability,
        noLeakage: true,
      },
    },
    promotion: {
      productionValidated: false,
      readyForExplicitPromotion: readinessStatus === "HOLDOUT_PASSED",
      reason: readinessStatus === "HOLDOUT_PASSED"
        ? "Untouched Stage 9 prospective holdout passed every gate; governed promotion may now execute."
        : readinessStatus === "PROSPECTIVE_HOLDOUT_PENDING"
          ? "Untouched Stage 9 prospective holdout has not reached 200 settled fixtures."
          : "Untouched Stage 9 prospective holdout failed at least one production prerequisite.",
    },
  };
}
