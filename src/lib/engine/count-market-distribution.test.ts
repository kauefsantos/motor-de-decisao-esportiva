import { describe, expect, it } from "vitest";
import {
  COUNT_DISTRIBUTION_POLICY_VERSION,
  MIN_DISPERSION_TRAIN_MATCHES,
  chooseCountDistribution,
  countDistributionMetadata,
  distributionFromStoredOutcome,
} from "./count-market-distribution";

function totalProbability(dist: Map<number, number>) {
  return [...dist.values()].reduce((sum, value) => sum + value, 0);
}

describe("count market distribution policy", () => {
  it.each([
    "corners_match_total",
    "corners_team_total",
    "cards_match_total",
  ] as const)("uses negative binomial for validated market %s with enough history", (market) => {
    const result = chooseCountDistribution({
      market,
      lambda: 8,
      estimatedAlpha: 0.12,
      trainingMatches: MIN_DISPERSION_TRAIN_MATCHES,
    });

    expect(result.kind).toBe("negative_binomial");
    expect(result.alphaApplied).toBeCloseTo(0.12);
    expect(result.reason).toBe("walk_forward_validated");
    expect(totalProbability(result.distribution)).toBeCloseTo(1, 8);
  });

  it("keeps team cards on Poisson even when overdispersion exists", () => {
    const result = chooseCountDistribution({
      market: "cards_team_total",
      lambda: 4.2,
      estimatedAlpha: 0.4,
      trainingMatches: 200,
    });

    expect(result.kind).toBe("poisson");
    expect(result.alphaApplied).toBe(0);
    expect(result.estimatedAlpha).toBeCloseTo(0.4);
    expect(result.reason).toBe("poisson_only_market");
  });

  it("falls back to Poisson below the minimum dispersion sample", () => {
    const result = chooseCountDistribution({
      market: "corners_match_total",
      lambda: 9.5,
      estimatedAlpha: 0.2,
      trainingMatches: MIN_DISPERSION_TRAIN_MATCHES - 1,
    });

    expect(result.kind).toBe("poisson");
    expect(result.reason).toBe("insufficient_training");
    expect(result.alphaApplied).toBe(0);
  });

  it("falls back to Poisson when the fitted dispersion is zero", () => {
    const result = chooseCountDistribution({
      market: "cards_match_total",
      lambda: 4.5,
      estimatedAlpha: 0,
      trainingMatches: 120,
    });

    expect(result.kind).toBe("poisson");
    expect(result.reason).toBe("no_positive_dispersion");
  });

  it("persists enough metadata to reproduce the probability distribution", () => {
    const policy = chooseCountDistribution({
      market: "corners_match_total",
      lambda: 10,
      estimatedAlpha: 0.1,
      trainingMatches: 100,
    });
    const metadata = countDistributionMetadata({ lambda: 10, policy });
    const rebuilt = distributionFromStoredOutcome(metadata);

    expect(metadata.distribution_policy).toBe(COUNT_DISTRIBUTION_POLICY_VERSION);
    expect(metadata.distribution).toBe("negative_binomial");
    expect(metadata.estimated_alpha).toBeCloseTo(0.1);
    expect(rebuilt).not.toBeNull();
    expect(totalProbability(rebuilt!)).toBeCloseTo(1, 8);
    expect([...rebuilt!.entries()]).toEqual([...policy.distribution.entries()]);
  });

  it("keeps legacy lambda-only predictions reproducible as Poisson", () => {
    const rebuilt = distributionFromStoredOutcome({ lambda: 7.25 });
    expect(rebuilt).not.toBeNull();
    expect(totalProbability(rebuilt!)).toBeCloseTo(1, 8);
  });
});
