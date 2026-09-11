import { describe, expect, it } from "vitest";

import { validateBinaryCandidate, validateCountCandidate } from "./feature-validation";

describe("walk-forward feature gate", () => {
  it("approves a binary candidate only when paired out-of-sample scores improve", () => {
    const points = Array.from({ length: 80 }, (_, i) => ({
      date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}-${String(i).padStart(3, "0")}`,
      baselineProbability: i % 2 === 0 ? 0.6 : 0.4,
      candidateProbability: i % 2 === 0 ? 0.75 : 0.25,
      outcome: i % 2 === 0,
    }));

    expect(validateBinaryCandidate(points).status).toBe("APPROVED");
  });

  it("rejects a count candidate that worsens the frozen baseline", () => {
    const points = Array.from({ length: 70 }, (_, i) => ({
      date: `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      baselineMean: 10,
      candidateMean: 14,
      actual: 10 + (i % 3) - 1,
    }));

    expect(validateCountCandidate(points).status).toBe("REJECTED");
  });

  it("blocks promotion when the out-of-sample sample is too small", () => {
    const points = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-08-${String(i + 1).padStart(2, "0")}`,
      baselineMean: 10,
      candidateMean: 9.5,
      actual: 9,
    }));

    expect(validateCountCandidate(points).status).toBe("INSUFFICIENT_DATA");
  });
});
