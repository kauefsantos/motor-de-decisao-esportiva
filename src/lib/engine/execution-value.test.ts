import { describe, expect, it } from "vitest";

import { executionValueContract } from "./execution-value";

function sum(values: Record<string, number>) {
  return Object.values(values).reduce((total, value) => total + value, 0);
}

describe("executionValueContract", () => {
  it("keeps non-total markets on the binary path", () => {
    expect(executionValueContract({
      market: "1x2",
      side: "HOME",
      lineCanonical: null,
      storedOutcomeDistribution: {},
    })).toEqual({ contractType: "BINARY", outcomeDistribution: null });
  });

  it("uses Asian settlement for total markets and preserves push probability", () => {
    const resolved = executionValueContract({
      market: "goals_match_total",
      side: "OVER",
      lineCanonical: 2,
      storedOutcomeDistribution: { lambda: 2.4 },
    });

    expect(resolved.contractType).toBe("ASIAN");
    expect(resolved.outcomeDistribution).not.toBeNull();
    expect(resolved.outcomeDistribution!.PUSH).toBeGreaterThan(0);
    expect(sum(resolved.outcomeDistribution!)).toBeCloseTo(1, 8);
  });

  it("fails closed when a totals prediction cannot rebuild its distribution", () => {
    expect(executionValueContract({
      market: "corners_match_total",
      side: "OVER",
      lineCanonical: 9.5,
      storedOutcomeDistribution: {},
    })).toEqual({ contractType: "ASIAN", outcomeDistribution: null });
  });
});
