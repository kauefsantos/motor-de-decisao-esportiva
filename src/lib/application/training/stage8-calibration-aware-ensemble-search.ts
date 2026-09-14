import { multiclassMetrics, type MulticlassLabel, type MulticlassMetricInput } from "./model-validation";
import {
  STAGE6_GOALS_ELO_ARTIFACT,
  buildStage6GoalsPredictions,
  type Stage6GoalRow,
} from "./goals-walk-forward";
import {
  STAGE8_ELO_PURE60_ADVANTAGE,
  buildStage8PureEloPredictions,
  type Stage8PureEloPrediction,
} from "./stage8-elo-pure-challenger";
import {
  STAGE8_MULTI_FORMULA_SELECTION_START,
  applyStage8FormulaCandidate,
  type Stage8FormulaCandidate,
} from "./stage8-multi-formula-search";

export const STAGE8_CALIBRATION_AWARE_ARTIFACT = "stage8-calibration-aware-ensemble-search-v1";

const EPS = 1e-12;
const CALIBRATION_GATE = 0.1;

type BasePrediction = ReturnType<typeof buildStage6GoalsPredictions>[number];
type Probabilities = Record<MulticlassLabel, number>;

type PairedRow = {
  fixtureId: string;
  date: string;
  league: string;
  outcome: MulticlassLabel;
  base: Probabilities;
  elo: Probabilities;
};

export type Stage8CalibrationAwareCandidate = {
  id: string;
  basis: Stage8FormulaCandidate;
  temperature: number;
  uniformShrink: number;
  capMax: number | null;
};

type CandidateScore = {
  candidate: Stage8CalibrationAwareCandidate;
  metrics: ReturnType<typeof multiclassMetrics>;
  deltas: {
    brier: number;
    logLoss: number;
    expectedCalibrationError: number;
    maxCalibrationGap: number;
  };
  scoringNonDegrading: boolean;
  passesCalibrationGate: boolean;
  passesAllSelectionGates: boolean;
  objective: number;
};

function fixtureKey(row: Pick<BasePrediction, "league" | "fixtureId">): string {
  return `${row.league}::${row.fixtureId}`;
}

function normalize(probabilities: Probabilities): Probabilities {
  const home = Math.max(EPS, probabilities.HOME);
  const draw = Math.max(EPS, probabilities.DRAW);
  const away = Math.max(EPS, probabilities.AWAY);
  const total = home + draw + away;
  return { HOME: home / total, DRAW: draw / total, AWAY: away / total };
}

function temperatureScale(probabilities: Probabilities, temperature: number): Probabilities {
  const safeTemperature = Math.max(0.5, Math.min(3, temperature));
  return normalize({
    HOME: Math.max(EPS, probabilities.HOME) ** (1 / safeTemperature),
    DRAW: Math.max(EPS, probabilities.DRAW) ** (1 / safeTemperature),
    AWAY: Math.max(EPS, probabilities.AWAY) ** (1 / safeTemperature),
  });
}

function shrinkToUniform(probabilities: Probabilities, shrink: number): Probabilities {
  const safeShrink = Math.max(0, Math.min(0.5, shrink));
  const prior = 1 / 3;
  return normalize({
    HOME: probabilities.HOME * (1 - safeShrink) + prior * safeShrink,
    DRAW: probabilities.DRAW * (1 - safeShrink) + prior * safeShrink,
    AWAY: probabilities.AWAY * (1 - safeShrink) + prior * safeShrink,
  });
}

function capMaximumProbability(probabilities: Probabilities, cap: number | null): Probabilities {
  if (cap === null) return probabilities;
  const safeCap = Math.max(1 / 3, Math.min(0.95, cap));
  const labels: MulticlassLabel[] = ["HOME", "DRAW", "AWAY"];
  let maxLabel: MulticlassLabel = "HOME";
  for (const label of labels) {
    if (probabilities[label] > probabilities[maxLabel]) maxLabel = label;
  }
  const maxProbability = probabilities[maxLabel];
  if (maxProbability <= safeCap) return probabilities;

  const remainingCurrent = Math.max(EPS, 1 - maxProbability);
  const remainingTarget = 1 - safeCap;
  const scale = remainingTarget / remainingCurrent;
  const output: Probabilities = { ...probabilities };
  output[maxLabel] = safeCap;
  for (const label of labels) {
    if (label === maxLabel) continue;
    output[label] = probabilities[label] * scale;
  }
  return normalize(output);
}

export function applyStage8CalibrationAwareCandidate(
  base: Probabilities,
  elo: Probabilities,
  candidate: Stage8CalibrationAwareCandidate,
): Probabilities {
  const blended = applyStage8FormulaCandidate(base, elo, candidate.basis);
  const tempered = temperatureScale(blended, candidate.temperature);
  const shrunk = shrinkToUniform(tempered, candidate.uniformShrink);
  return capMaximumProbability(shrunk, candidate.capMax);
}

function basisCandidates(): Stage8FormulaCandidate[] {
  const bases: Stage8FormulaCandidate[] = [];
  for (const weight of [0.2, 0.3, 0.4, 0.5, 0.6]) {
    bases.push({ id: `uncertainty-linear-${weight}`, kind: "uncertainty_linear", weight });
  }
  for (const weight of [0.3, 0.4, 0.5, 0.6]) {
    bases.push({ id: `log-${weight}`, kind: "log_pool", weight });
  }
  for (const weight of [0.3, 0.4, 0.5]) {
    bases.push({ id: `linear-${weight}`, kind: "linear", weight });
  }
  return bases;
}

export function stage8CalibrationAwareCandidates(): Stage8CalibrationAwareCandidate[] {
  const candidates: Stage8CalibrationAwareCandidate[] = [];
  const temperatures = [1, 1.05, 1.1, 1.15, 1.2, 1.3, 1.4, 1.5];
  const shrinks = [0, 0.01, 0.02, 0.03, 0.05, 0.08, 0.1];

  for (const basis of basisCandidates()) {
    for (const temperature of temperatures) {
      for (const uniformShrink of shrinks) {
        candidates.push({
          id: `${basis.id}-t${temperature}-s${uniformShrink}`,
          basis,
          temperature,
          uniformShrink,
          capMax: null,
        });
      }
    }
    for (const capMax of [0.85, 0.8, 0.75, 0.7, 0.65]) {
      candidates.push({
        id: `${basis.id}-cap${capMax}`,
        basis,
        temperature: 1,
        uniformShrink: 0,
        capMax,
      });
    }
  }
  return candidates;
}

function pairedRows(
  baseRows: readonly BasePrediction[],
  eloRows: readonly Stage8PureEloPrediction[],
  startInclusive: string,
  endExclusive: string,
): PairedRow[] {
  const eloByFixture = new Map(eloRows.map((row) => [fixtureKey(row), row] as const));
  const paired: PairedRow[] = [];
  for (const base of baseRows) {
    if (base.date < startInclusive || base.date >= endExclusive) continue;
    const elo = eloByFixture.get(fixtureKey(base));
    if (!elo) continue;
    paired.push({
      fixtureId: base.fixtureId,
      date: base.date,
      league: base.league,
      outcome: base.outcome1x2,
      base: { HOME: base.homeProbability, DRAW: base.drawProbability, AWAY: base.awayProbability },
      elo: { HOME: elo.homeProbability, DRAW: elo.drawProbability, AWAY: elo.awayProbability },
    });
  }
  return paired;
}

function metricInputs(
  rows: readonly PairedRow[],
  candidate?: Stage8CalibrationAwareCandidate,
): MulticlassMetricInput[] {
  return rows.map((row) => ({
    probabilities: candidate
      ? applyStage8CalibrationAwareCandidate(row.base, row.elo, candidate)
      : row.base,
    outcome: row.outcome,
  }));
}

function scoreCandidate(
  rows: readonly PairedRow[],
  baseMetrics: ReturnType<typeof multiclassMetrics>,
  candidate: Stage8CalibrationAwareCandidate,
): CandidateScore {
  const metrics = multiclassMetrics(metricInputs(rows, candidate));
  const deltas = {
    brier: metrics.brier - baseMetrics.brier,
    logLoss: metrics.logLoss - baseMetrics.logLoss,
    expectedCalibrationError: metrics.expectedCalibrationError - baseMetrics.expectedCalibrationError,
    maxCalibrationGap: metrics.maxCalibrationGap - baseMetrics.maxCalibrationGap,
  };
  const scoringNonDegrading = deltas.brier <= EPS && deltas.logLoss <= EPS;
  const passesCalibrationGate = metrics.maxCalibrationGap <= CALIBRATION_GATE;
  return {
    candidate,
    metrics,
    deltas,
    scoringNonDegrading,
    passesCalibrationGate,
    passesAllSelectionGates: scoringNonDegrading && passesCalibrationGate,
    objective: deltas.brier + deltas.logLoss,
  };
}

function compactScore(score: CandidateScore) {
  return {
    candidate: score.candidate,
    sampleSize: score.metrics.sampleSize,
    brier: score.metrics.brier,
    logLoss: score.metrics.logLoss,
    expectedCalibrationError: score.metrics.expectedCalibrationError,
    maxCalibrationGap: score.metrics.maxCalibrationGap,
    deltas: score.deltas,
    scoringNonDegrading: score.scoringNonDegrading,
    passesCalibrationGate: score.passesCalibrationGate,
    passesAllSelectionGates: score.passesAllSelectionGates,
    objective: score.objective,
  };
}

function bestScoring(scores: readonly CandidateScore[]): CandidateScore | null {
  const pool = scores.filter((score) => score.scoringNonDegrading);
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => a.objective - b.objective || a.metrics.maxCalibrationGap - b.metrics.maxCalibrationGap)[0] ?? null;
}

function bestCalibrationAmongScoring(scores: readonly CandidateScore[]): CandidateScore | null {
  const pool = scores.filter((score) => score.scoringNonDegrading);
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => a.metrics.maxCalibrationGap - b.metrics.maxCalibrationGap || a.objective - b.objective)[0] ?? null;
}

function bestGatePassing(scores: readonly CandidateScore[]): CandidateScore | null {
  const pool = scores.filter((score) => score.passesAllSelectionGates);
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => a.objective - b.objective || a.metrics.expectedCalibrationError - b.metrics.expectedCalibrationError)[0] ?? null;
}

function stability(
  rows: readonly PairedRow[],
  candidate: Stage8CalibrationAwareCandidate,
  dimension: "month" | "league",
) {
  const keys = dimension === "month"
    ? [...new Set(rows.map((row) => row.date.slice(0, 7)))].sort()
    : [...new Set(rows.map((row) => row.league))].sort();
  return keys.map((key) => {
    const slice = rows.filter((row) => (dimension === "month" ? row.date.startsWith(key) : row.league === key));
    const baseMetrics = multiclassMetrics(metricInputs(slice));
    const challengerMetrics = multiclassMetrics(metricInputs(slice, candidate));
    return {
      key,
      sampleSize: slice.length,
      brierDelta: challengerMetrics.brier - baseMetrics.brier,
      logLossDelta: challengerMetrics.logLoss - baseMetrics.logLoss,
      expectedCalibrationErrorDelta:
        challengerMetrics.expectedCalibrationError - baseMetrics.expectedCalibrationError,
      maxCalibrationGapDelta: challengerMetrics.maxCalibrationGap - baseMetrics.maxCalibrationGap,
    };
  });
}

function evaluateChampion(
  rows: readonly PairedRow[],
  baseMetrics: ReturnType<typeof multiclassMetrics>,
  champion: CandidateScore | null,
) {
  if (!champion) return null;
  const evaluated = scoreCandidate(rows, baseMetrics, champion.candidate);
  return {
    ...compactScore(evaluated),
    passesAllEvaluationGates:
      evaluated.deltas.brier < 0
      && evaluated.deltas.logLoss < 0
      && evaluated.metrics.maxCalibrationGap <= CALIBRATION_GATE,
  };
}

export function runStage8CalibrationAwareEnsembleSearch(
  sourceRows: readonly Stage6GoalRow[],
  evaluationStartInclusive: string,
  evaluationEndExclusive: string,
) {
  const baseAll = buildStage6GoalsPredictions(sourceRows, STAGE6_GOALS_ELO_ARTIFACT);
  const eloAll = buildStage8PureEloPredictions(sourceRows, STAGE8_ELO_PURE60_ADVANTAGE);
  const candidates = stage8CalibrationAwareCandidates();

  const selectionRows = pairedRows(
    baseAll,
    eloAll,
    STAGE8_MULTI_FORMULA_SELECTION_START,
    evaluationStartInclusive,
  );
  const evaluationRows = pairedRows(baseAll, eloAll, evaluationStartInclusive, evaluationEndExclusive);
  const selectionBase = multiclassMetrics(metricInputs(selectionRows));
  const evaluationBase = multiclassMetrics(metricInputs(evaluationRows));

  const selectionScores = candidates.map((candidate) => scoreCandidate(selectionRows, selectionBase, candidate));
  const gateChampion = bestGatePassing(selectionScores);
  const calibrationChampion = bestCalibrationAmongScoring(selectionScores);
  const scoringChampion = bestScoring(selectionScores);
  const primary = gateChampion ?? calibrationChampion ?? scoringChampion;
  if (!primary) throw new Error("Stage 8 calibration-aware search found no scoring-nondegrading candidate.");

  const evaluatedPrimary = evaluateChampion(evaluationRows, evaluationBase, primary);
  if (!evaluatedPrimary) throw new Error("Stage 8 calibration-aware primary evaluation is missing.");
  const evaluatedGate = evaluateChampion(evaluationRows, evaluationBase, gateChampion);
  const evaluatedCalibration = evaluateChampion(evaluationRows, evaluationBase, calibrationChampion);
  const evaluatedScoring = evaluateChampion(evaluationRows, evaluationBase, scoringChampion);

  const months = stability(evaluationRows, primary.candidate, "month");
  const leagues = stability(evaluationRows, primary.candidate, "league");
  const leaguesN30 = leagues.filter((row) => row.sampleSize >= 30);

  const topGate = selectionScores
    .filter((score) => score.passesAllSelectionGates)
    .sort((a, b) => a.objective - b.objective)
    .slice(0, 10)
    .map(compactScore);
  const topCalibration = selectionScores
    .filter((score) => score.scoringNonDegrading)
    .sort((a, b) => a.metrics.maxCalibrationGap - b.metrics.maxCalibrationGap || a.objective - b.objective)
    .slice(0, 10)
    .map(compactScore);

  return {
    challengerArtifact: STAGE8_CALIBRATION_AWARE_ARTIFACT,
    methodology: "pre-retrospective-ensemble-plus-probability-compression-search",
    candidateCount: candidates.length,
    calibrationGate: CALIBRATION_GATE,
    selectionWindow: {
      startInclusive: STAGE8_MULTI_FORMULA_SELECTION_START,
      endExclusive: evaluationStartInclusive,
      sampleSize: selectionRows.length,
    },
    evaluationWindow: {
      startInclusive: evaluationStartInclusive,
      endExclusive: evaluationEndExclusive,
      sampleSize: evaluationRows.length,
    },
    selectionIncumbent: selectionBase,
    selectionGatePassingCount: selectionScores.filter((score) => score.passesAllSelectionGates).length,
    selectionScoringNonDegradingCount: selectionScores.filter((score) => score.scoringNonDegrading).length,
    topGatePassing: topGate,
    topCalibrationAmongScoring: topCalibration,
    selectedPrimary: compactScore(primary),
    selectedPrimaryReason: gateChampion
      ? "BEST_SCORING_AMONG_SELECTION_GATE_PASSERS"
      : calibrationChampion
        ? "NO_SELECTION_GATE_PASSER__LOWEST_GAP_AMONG_SCORING_NONDEGRADING"
        : "LEAST_BAD_SCORING_CHAMPION",
    preselectedChampions: {
      gate: gateChampion ? compactScore(gateChampion) : null,
      calibration: calibrationChampion ? compactScore(calibrationChampion) : null,
      scoring: scoringChampion ? compactScore(scoringChampion) : null,
    },
    evaluation: {
      incumbent: evaluationBase,
      primary: evaluatedPrimary,
      gateChampion: evaluatedGate,
      calibrationChampion: evaluatedCalibration,
      scoringChampion: evaluatedScoring,
      stableMonths:
        months.filter((row) => row.brierDelta <= 0 && row.logLossDelta <= 0).length,
      totalMonths: months.length,
      stableLeaguesN30:
        leaguesN30.filter((row) => row.brierDelta <= 0 && row.logLossDelta <= 0).length,
      totalLeaguesN30: leaguesN30.length,
      stabilityByMonth: months,
      stabilityByLeague: leagues,
    },
    recommendation: evaluatedPrimary.passesAllEvaluationGates
      ? "ADVANCE_TO_GOVERNED_SHADOW_CANDIDATE"
      : evaluatedPrimary.deltas.brier < 0 && evaluatedPrimary.deltas.logLoss < 0
        ? "SCORING_IMPROVED_BUT_CALIBRATION_GATE_FAILED"
        : "KEEP_INCUMBENT",
    governance: {
      benchmarkFrozen: true,
      incumbentModified: false,
      finalHoldoutUsedForFeatureSelection: false,
      retrospectiveWindowUsedToSelectCandidate: false,
      promotionAttempted: false,
      productionValidated: false,
      calibrationTolerance: CALIBRATION_GATE,
      calibrationToleranceRelaxed: false,
      realStakeUnlocked: false,
    },
  };
}
