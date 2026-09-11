export type BinaryWalkForwardPoint = {
  date: string;
  baselineProbability: number;
  candidateProbability: number;
  outcome: boolean;
};

export type CountWalkForwardPoint = {
  date: string;
  baselineMean: number;
  candidateMean: number;
  actual: number;
};

export type FeatureGateResult = {
  status: "APPROVED" | "REJECTED" | "INSUFFICIENT_DATA";
  observations: number;
  baselinePrimary: number | null;
  candidatePrimary: number | null;
  baselineSecondary: number | null;
  candidateSecondary: number | null;
  relativeImprovement: number | null;
  reason: string;
};

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function logLoss(probability: number, outcome: boolean) {
  const p = Math.min(1 - 1e-9, Math.max(1e-9, probability));
  return outcome ? -Math.log(p) : -Math.log(1 - p);
}

function chronological<T extends { date: string }>(points: T[]) {
  return [...points].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Paired out-of-sample gate. The caller must build every baseline/candidate
 * prediction using only information available before each point's date.
 * This module deliberately does not train a model or peek at future rows.
 */
export function validateBinaryCandidate(
  points: BinaryWalkForwardPoint[],
  minObservations = 60,
): FeatureGateResult {
  const ordered = chronological(points).filter((point) =>
    Number.isFinite(point.baselineProbability) &&
    Number.isFinite(point.candidateProbability) &&
    point.baselineProbability > 0 && point.baselineProbability < 1 &&
    point.candidateProbability > 0 && point.candidateProbability < 1,
  );

  if (ordered.length < minObservations) {
    return {
      status: "INSUFFICIENT_DATA",
      observations: ordered.length,
      baselinePrimary: null,
      candidatePrimary: null,
      baselineSecondary: null,
      candidateSecondary: null,
      relativeImprovement: null,
      reason: `São necessárias pelo menos ${minObservations} previsões estritamente fora da amostra.`,
    };
  }

  const baselineBrier = mean(ordered.map((p) => (p.baselineProbability - Number(p.outcome)) ** 2));
  const candidateBrier = mean(ordered.map((p) => (p.candidateProbability - Number(p.outcome)) ** 2));
  const baselineLogLoss = mean(ordered.map((p) => logLoss(p.baselineProbability, p.outcome)));
  const candidateLogLoss = mean(ordered.map((p) => logLoss(p.candidateProbability, p.outcome)));
  const relativeImprovement = baselineBrier > 0
    ? (baselineBrier - candidateBrier) / baselineBrier
    : 0;
  const approved = candidateBrier < baselineBrier && candidateLogLoss <= baselineLogLoss;

  return {
    status: approved ? "APPROVED" : "REJECTED",
    observations: ordered.length,
    baselinePrimary: baselineBrier,
    candidatePrimary: candidateBrier,
    baselineSecondary: baselineLogLoss,
    candidateSecondary: candidateLogLoss,
    relativeImprovement,
    reason: approved
      ? "A feature melhorou Brier fora da amostra sem piorar log loss."
      : "A feature não superou simultaneamente o baseline nos critérios definidos.",
  };
}

export function validateCountCandidate(
  points: CountWalkForwardPoint[],
  minObservations = 60,
): FeatureGateResult {
  const ordered = chronological(points).filter((point) =>
    Number.isFinite(point.baselineMean) &&
    Number.isFinite(point.candidateMean) &&
    Number.isFinite(point.actual) &&
    point.baselineMean >= 0 && point.candidateMean >= 0 && point.actual >= 0,
  );

  if (ordered.length < minObservations) {
    return {
      status: "INSUFFICIENT_DATA",
      observations: ordered.length,
      baselinePrimary: null,
      candidatePrimary: null,
      baselineSecondary: null,
      candidateSecondary: null,
      relativeImprovement: null,
      reason: `São necessárias pelo menos ${minObservations} previsões estritamente fora da amostra.`,
    };
  }

  const baselineMae = mean(ordered.map((p) => Math.abs(p.actual - p.baselineMean)));
  const candidateMae = mean(ordered.map((p) => Math.abs(p.actual - p.candidateMean)));
  const baselineRmse = Math.sqrt(mean(ordered.map((p) => (p.actual - p.baselineMean) ** 2)));
  const candidateRmse = Math.sqrt(mean(ordered.map((p) => (p.actual - p.candidateMean) ** 2)));
  const relativeImprovement = baselineMae > 0
    ? (baselineMae - candidateMae) / baselineMae
    : 0;
  const approved = candidateMae < baselineMae && candidateRmse <= baselineRmse;

  return {
    status: approved ? "APPROVED" : "REJECTED",
    observations: ordered.length,
    baselinePrimary: baselineMae,
    candidatePrimary: candidateMae,
    baselineSecondary: baselineRmse,
    candidateSecondary: candidateRmse,
    relativeImprovement,
    reason: approved
      ? "A feature melhorou MAE fora da amostra sem piorar RMSE."
      : "A feature não superou simultaneamente o baseline nos critérios definidos.",
  };
}
