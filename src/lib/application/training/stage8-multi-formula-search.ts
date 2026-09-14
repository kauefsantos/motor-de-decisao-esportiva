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

export const STAGE8_MULTI_FORMULA_ARTIFACT = "stage8-multi-formula-search-v1";
export const STAGE8_MULTI_FORMULA_SELECTION_START = "2026-03-01";

const EPS = 1e-12;

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

type CandidateKind =
  | "linear"
  | "log_pool"
  | "draw_only"
  | "decisive_only"
  | "draw_decisive"
  | "uncertainty_linear"
  | "close_game_linear";

export type Stage8FormulaCandidate = {
  id: string;
  kind: CandidateKind;
  weight?: number;
  drawWeight?: number;
  decisiveWeight?: number;
  closeGameThreshold?: number;
};

type CandidateScore = {
  candidate: Stage8FormulaCandidate;
  metrics: ReturnType<typeof multiclassMetrics>;
  deltas: {
    brier: number;
    logLoss: number;
    expectedCalibrationError: number;
    maxCalibrationGap: number;
  };
  scoringNonDegrading: boolean;
  passesCalibrationGate: boolean;
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

function linearBlend(base: Probabilities, elo: Probabilities, weight: number): Probabilities {
  return normalize({
    HOME: base.HOME * (1 - weight) + elo.HOME * weight,
    DRAW: base.DRAW * (1 - weight) + elo.DRAW * weight,
    AWAY: base.AWAY * (1 - weight) + elo.AWAY * weight,
  });
}

function logPool(base: Probabilities, elo: Probabilities, weight: number): Probabilities {
  return normalize({
    HOME: Math.max(EPS, base.HOME) ** (1 - weight) * Math.max(EPS, elo.HOME) ** weight,
    DRAW: Math.max(EPS, base.DRAW) ** (1 - weight) * Math.max(EPS, elo.DRAW) ** weight,
    AWAY: Math.max(EPS, base.AWAY) ** (1 - weight) * Math.max(EPS, elo.AWAY) ** weight,
  });
}

function drawDecisiveBlend(
  base: Probabilities,
  elo: Probabilities,
  drawWeight: number,
  decisiveWeight: number,
): Probabilities {
  const draw = base.DRAW * (1 - drawWeight) + elo.DRAW * drawWeight;
  const baseDecisive = Math.max(EPS, base.HOME + base.AWAY);
  const eloDecisive = Math.max(EPS, elo.HOME + elo.AWAY);
  const baseHomeShare = base.HOME / baseDecisive;
  const eloHomeShare = elo.HOME / eloDecisive;
  const homeShare = baseHomeShare * (1 - decisiveWeight) + eloHomeShare * decisiveWeight;
  const decisiveMass = Math.max(EPS, 1 - draw);
  return normalize({
    HOME: decisiveMass * homeShare,
    DRAW: draw,
    AWAY: decisiveMass * (1 - homeShare),
  });
}

function uncertainty(base: Probabilities): number {
  const sorted = [base.HOME, base.DRAW, base.AWAY].sort((a, b) => b - a);
  const margin = (sorted[0] ?? 0) - (sorted[1] ?? 0);
  return Math.max(0, Math.min(1, 1 - margin));
}

export function applyStage8FormulaCandidate(
  base: Probabilities,
  elo: Probabilities,
  candidate: Stage8FormulaCandidate,
): Probabilities {
  switch (candidate.kind) {
    case "linear":
      return linearBlend(base, elo, candidate.weight ?? 0);
    case "log_pool":
      return logPool(base, elo, candidate.weight ?? 0);
    case "draw_only":
      return drawDecisiveBlend(base, elo, candidate.weight ?? 0, 0);
    case "decisive_only":
      return drawDecisiveBlend(base, elo, 0, candidate.weight ?? 0);
    case "draw_decisive":
      return drawDecisiveBlend(base, elo, candidate.drawWeight ?? 0, candidate.decisiveWeight ?? 0);
    case "uncertainty_linear":
      return linearBlend(base, elo, (candidate.weight ?? 0) * uncertainty(base));
    case "close_game_linear": {
      const sorted = [base.HOME, base.DRAW, base.AWAY].sort((a, b) => b - a);
      const margin = (sorted[0] ?? 0) - (sorted[1] ?? 0);
      const active = margin <= (candidate.closeGameThreshold ?? 0.15);
      return active ? linearBlend(base, elo, candidate.weight ?? 0) : base;
    }
  }
}

export function stage8FormulaCandidates(): Stage8FormulaCandidate[] {
  const candidates: Stage8FormulaCandidate[] = [];
  const generalWeights = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5];
  for (const weight of generalWeights) {
    candidates.push({ id: `linear-${weight}`, kind: "linear", weight });
    candidates.push({ id: `log-${weight}`, kind: "log_pool", weight });
  }

  for (const weight of [0.1, 0.25, 0.5, 0.75, 1]) {
    candidates.push({ id: `draw-only-${weight}`, kind: "draw_only", weight });
  }
  for (const weight of [0.05, 0.1, 0.2, 0.3]) {
    candidates.push({ id: `decisive-only-${weight}`, kind: "decisive_only", weight });
  }
  for (const drawWeight of [0.25, 0.5, 0.75, 1]) {
    for (const decisiveWeight of [0.05, 0.1, 0.2]) {
      candidates.push({
        id: `draw-${drawWeight}-decisive-${decisiveWeight}`,
        kind: "draw_decisive",
        drawWeight,
        decisiveWeight,
      });
    }
  }
  for (const weight of [0.1, 0.2, 0.3, 0.4]) {
    candidates.push({ id: `uncertainty-linear-${weight}`, kind: "uncertainty_linear", weight });
  }
  for (const threshold of [0.1, 0.15, 0.2]) {
    for (const weight of [0.1, 0.2, 0.3]) {
      candidates.push({
        id: `close-${threshold}-linear-${weight}`,
        kind: "close_game_linear",
        weight,
        closeGameThreshold: threshold,
      });
    }
  }
  return candidates;
}

function probabilitiesFromBase(row: BasePrediction): Probabilities {
  return { HOME: row.homeProbability, DRAW: row.drawProbability, AWAY: row.awayProbability };
}

function probabilitiesFromElo(row: Stage8PureEloPrediction): Probabilities {
  return { HOME: row.homeProbability, DRAW: row.drawProbability, AWAY: row.awayProbability };
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
      base: probabilitiesFromBase(base),
      elo: probabilitiesFromElo(elo),
    });
  }
  return paired;
}

function metricInputs(rows: readonly PairedRow[], candidate?: Stage8FormulaCandidate): MulticlassMetricInput[] {
  return rows.map((row) => ({
    probabilities: candidate ? applyStage8FormulaCandidate(row.base, row.elo, candidate) : row.base,
    outcome: row.outcome,
  }));
}

function scoreCandidate(
  rows: readonly PairedRow[],
  baseMetrics: ReturnType<typeof multiclassMetrics>,
  candidate: Stage8FormulaCandidate,
): CandidateScore {
  const metrics = multiclassMetrics(metricInputs(rows, candidate));
  const deltas = {
    brier: metrics.brier - baseMetrics.brier,
    logLoss: metrics.logLoss - baseMetrics.logLoss,
    expectedCalibrationError: metrics.expectedCalibrationError - baseMetrics.expectedCalibrationError,
    maxCalibrationGap: metrics.maxCalibrationGap - baseMetrics.maxCalibrationGap,
  };
  return {
    candidate,
    metrics,
    deltas,
    scoringNonDegrading: deltas.brier <= EPS && deltas.logLoss <= EPS,
    passesCalibrationGate: metrics.maxCalibrationGap <= 0.1,
    objective: deltas.brier + deltas.logLoss,
  };
}

function rankCandidates(scores: readonly CandidateScore[]): CandidateScore[] {
  return [...scores].sort((a, b) => {
    const scoringBucket = Number(b.scoringNonDegrading) - Number(a.scoringNonDegrading);
    if (scoringBucket !== 0) return scoringBucket;
    if (Math.abs(a.objective - b.objective) > EPS) return a.objective - b.objective;
    return a.metrics.maxCalibrationGap - b.metrics.maxCalibrationGap;
  });
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
    objective: score.objective,
  };
}

function stability(
  rows: readonly PairedRow[],
  candidate: Stage8FormulaCandidate,
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

export function runStage8MultiFormulaSearch(
  sourceRows: readonly Stage6GoalRow[],
  evaluationStartInclusive: string,
  evaluationEndExclusive: string,
) {
  const baseAll = buildStage6GoalsPredictions(sourceRows, STAGE6_GOALS_ELO_ARTIFACT);
  const eloAll = buildStage8PureEloPredictions(sourceRows, STAGE8_ELO_PURE60_ADVANTAGE);
  const candidates = stage8FormulaCandidates();

  const selection = pairedRows(
    baseAll,
    eloAll,
    STAGE8_MULTI_FORMULA_SELECTION_START,
    evaluationStartInclusive,
  );
  const evaluation = pairedRows(baseAll, eloAll, evaluationStartInclusive, evaluationEndExclusive);

  const selectionBase = multiclassMetrics(metricInputs(selection));
  const selectionScores = rankCandidates(
    candidates.map((candidate) => scoreCandidate(selection, selectionBase, candidate)),
  );
  const selected = selectionScores[0];
  if (!selected) throw new Error("Stage 8 multi-formula search produced no candidate.");

  const evaluationBase = multiclassMetrics(metricInputs(evaluation));
  const evaluationSelected = scoreCandidate(evaluation, evaluationBase, selected.candidate);
  const evaluationScores = rankCandidates(
    candidates.map((candidate) => scoreCandidate(evaluation, evaluationBase, candidate)),
  );
  const diagnosticOracle = evaluationScores[0];
  if (!diagnosticOracle) throw new Error("Stage 8 multi-formula evaluation produced no candidate.");

  const months = stability(evaluation, selected.candidate, "month");
  const leagues = stability(evaluation, selected.candidate, "league");
  const stableMonths = months.filter((row) => row.brierDelta <= 0 && row.logLossDelta <= 0).length;
  const leaguesN30 = leagues.filter((row) => row.sampleSize >= 30);
  const stableLeaguesN30 = leaguesN30.filter((row) => row.brierDelta <= 0 && row.logLossDelta <= 0).length;

  const beatsIncumbentScoring = evaluationSelected.deltas.brier < 0 && evaluationSelected.deltas.logLoss < 0;
  const passesCalibrationGate = evaluationSelected.metrics.maxCalibrationGap <= 0.1;

  return {
    challengerArtifact: STAGE8_MULTI_FORMULA_ARTIFACT,
    methodology: "pre-retrospective-multi-family-ensemble-search",
    candidateCount: candidates.length,
    sourceModels: {
      incumbent: STAGE6_GOALS_ELO_ARTIFACT,
      auxiliary: "stage8-elo-pure60-davidson-v1",
    },
    selectionWindow: {
      startInclusive: STAGE8_MULTI_FORMULA_SELECTION_START,
      endExclusive: evaluationStartInclusive,
      sampleSize: selection.length,
    },
    evaluationWindow: {
      startInclusive: evaluationStartInclusive,
      endExclusive: evaluationEndExclusive,
      sampleSize: evaluation.length,
    },
    selectionIncumbent: selectionBase,
    selectionTop10: selectionScores.slice(0, 10).map(compactScore),
    selectedCandidate: compactScore(selected),
    selectionStatus: selected.scoringNonDegrading ? "SCORING_NON_DEGRADING" : "LEAST_BAD_ONLY",
    evaluation: {
      incumbent: evaluationBase,
      selected: compactScore(evaluationSelected),
      beatsIncumbentScoring,
      passesCalibrationGate,
      stableMonths,
      totalMonths: months.length,
      stableLeaguesN30,
      totalLeaguesN30: leaguesN30.length,
      stabilityByMonth: months,
      stabilityByLeague: leagues,
    },
    diagnosticOracleNotEligibleForSelection: compactScore(diagnosticOracle),
    recommendation: beatsIncumbentScoring && passesCalibrationGate
      ? "ADVANCE_TO_GOVERNED_SHADOW_CANDIDATE"
      : beatsIncumbentScoring
        ? "BEST_SCORING_BUT_CALIBRATION_GATE_FAILED"
        : "KEEP_INCUMBENT",
    governance: {
      benchmarkFrozen: true,
      incumbentModified: false,
      finalHoldoutUsedForFeatureSelection: false,
      retrospectiveWindowUsedToSelectCandidate: false,
      diagnosticOracleEligibleForPromotion: false,
      promotionAttempted: false,
      productionValidated: false,
      calibrationTolerance: 0.1,
      calibrationToleranceRelaxed: false,
      realStakeUnlocked: false,
    },
  };
}
