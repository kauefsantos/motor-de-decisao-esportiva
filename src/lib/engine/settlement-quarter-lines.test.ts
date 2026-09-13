import { describe, expect, it } from "vitest";

import { asianOutcomes } from "./settlement";

function total(outcomes: ReturnType<typeof asianOutcomes>) {
  return outcomes.FULL_WIN + outcomes.HALF_WIN + outcomes.PUSH + outcomes.HALF_LOSS + outcomes.FULL_LOSS;
}

describe("Asian quarter-line settlement", () => {
  it("settles Over 2.25 on the same realized count for both halves", () => {
    const outcomes = asianOutcomes(new Map([[2, 0.5], [3, 0.5]]), 2.25, "OVER");

    expect(outcomes).toEqual({
      FULL_WIN: 0.5,
      HALF_WIN: 0,
      PUSH: 0,
      HALF_LOSS: 0.5,
      FULL_LOSS: 0,
    });
    expect(total(outcomes)).toBeCloseTo(1, 12);
  });

  it("settles Under 2.25 without impossible independent combinations", () => {
    const outcomes = asianOutcomes(new Map([[2, 0.5], [3, 0.5]]), 2.25, "UNDER");

    expect(outcomes).toEqual({
      FULL_WIN: 0,
      HALF_WIN: 0.5,
      PUSH: 0,
      HALF_LOSS: 0,
      FULL_LOSS: 0.5,
    });
    expect(total(outcomes)).toBeCloseTo(1, 12);
  });

  it("preserves half wins on Over 2.75", () => {
    const outcomes = asianOutcomes(new Map([[2, 0.25], [3, 0.5], [4, 0.25]]), 2.75, "OVER");

    expect(outcomes).toEqual({
      FULL_WIN: 0.25,
      HALF_WIN: 0.5,
      PUSH: 0,
      HALF_LOSS: 0,
      FULL_LOSS: 0.25,
    });
    expect(total(outcomes)).toBeCloseTo(1, 12);
  });

  it("preserves half losses on Under 2.75", () => {
    const outcomes = asianOutcomes(new Map([[2, 0.25], [3, 0.5], [4, 0.25]]), 2.75, "UNDER");

    expect(outcomes).toEqual({
      FULL_WIN: 0.25,
      HALF_WIN: 0,
      PUSH: 0,
      HALF_LOSS: 0.5,
      FULL_LOSS: 0.25,
    });
    expect(total(outcomes)).toBeCloseTo(1, 12);
  });
});
