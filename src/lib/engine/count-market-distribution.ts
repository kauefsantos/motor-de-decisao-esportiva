import { countDistribution, poissonDistribution } from "./corners";

export const COUNT_DISTRIBUTION_POLICY_VERSION = "count-contract-distribution-v1";
export const MIN_DISPERSION_TRAIN_MATCHES = 30;

export type CountMarket =
  | "corners_match_total"
  | "corners_team_total"
  | "cards_match_total"
  | "cards_team_total";

export type CountDistributionKind = "poisson" | "negative_binomial";
export type CountDistributionReason =
  | "walk_forward_validated"
  | "poisson_only_market"
  | "insufficient_training"
  | "no_positive_dispersion";

const NEGATIVE_BINOMIAL_VALIDATED_MARKETS = new Set<CountMarket>([
  "corners_match_total",
  "corners_team_total",
  "cards_match_total",
]);

export type CountDistributionPolicy = {
  kind: CountDistributionKind;
  alphaApplied: number;
  estimatedAlpha: number;
  trainingMatches: number;
  reason: CountDistributionReason;
  distribution: Map<number, number>;
};

function finiteNonNegative(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function chooseCountDistribution(input: {
  market: CountMarket;
  lambda: number;
  estimatedAlpha?: number | null;
  trainingMatches: number;
}): CountDistributionPolicy {
  const estimatedAlpha = finiteNonNegative(input.estimatedAlpha);
  const trainingMatches = Math.max(0, Math.floor(input.trainingMatches));
  const eligible = NEGATIVE_BINOMIAL_VALIDATED_MARKETS.has(input.market);
  const enoughTraining = trainingMatches >= MIN_DISPERSION_TRAIN_MATCHES;
  const hasDispersion = estimatedAlpha > 1e-8;

  let reason: CountDistributionReason;
  if (!eligible) reason = "poisson_only_market";
  else if (!enoughTraining) reason = "insufficient_training";
  else if (!hasDispersion) reason = "no_positive_dispersion";
  else reason = "walk_forward_validated";

  const useNegativeBinomial = reason === "walk_forward_validated";
  const alphaApplied = useNegativeBinomial ? estimatedAlpha : 0;

  return {
    kind: useNegativeBinomial ? "negative_binomial" : "poisson",
    alphaApplied,
    estimatedAlpha,
    trainingMatches,
    reason,
    distribution: useNegativeBinomial
      ? countDistribution(input.lambda, alphaApplied)
      : poissonDistribution(input.lambda, 60),
  };
}

export function countDistributionMetadata(input: {
  lambda: number;
  policy: CountDistributionPolicy;
}) {
  return {
    lambda: input.lambda,
    distribution: input.policy.kind,
    alpha_applied: input.policy.alphaApplied,
    estimated_alpha: input.policy.estimatedAlpha,
    dispersion_training_matches: input.policy.trainingMatches,
    distribution_policy: COUNT_DISTRIBUTION_POLICY_VERSION,
    distribution_reason: input.policy.reason,
  } as const;
}

/**
 * Rebuilds the exact count distribution recorded with a prediction. Legacy
 * rows that only contain lambda deliberately fall back to Poisson.
 */
export function distributionFromStoredOutcome(outcome: unknown): Map<number, number> | null {
  if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) return null;
  const record = outcome as Record<string, unknown>;
  const lambdaRaw = typeof record.lambda === "number" ? record.lambda : Number(record.lambda);
  if (!Number.isFinite(lambdaRaw) || lambdaRaw <= 0) return null;

  const kind = record.distribution;
  const alphaApplied = finiteNonNegative(record.alpha_applied);
  if (kind === "negative_binomial" && alphaApplied > 1e-8) {
    return countDistribution(lambdaRaw, alphaApplied);
  }
  return poissonDistribution(lambdaRaw, 60);
}
