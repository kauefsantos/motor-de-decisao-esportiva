import { describe, expect, it } from "vitest";

import { calculateClv } from "./clv";

describe("closing-line value", () => {
  it("reports positive CLV when the accepted price beats closing on the same contract", () => {
    const result = calculateClv({
      entryOdd: 2.0,
      closingOdd: 1.8,
      entryLine: 2.5,
      closingLine: 2.5,
    });

    expect(result.status).toBe("MATCHED");
    expect(result.clvPct).toBeCloseTo(2 / 1.8 - 1, 10);
    expect(result.impliedDelta).toBeCloseTo(1 / 1.8 - 1 / 2, 10);
  });

  it("never compares odds across a moved total line", () => {
    const result = calculateClv({
      entryOdd: 1.95,
      closingOdd: 2.05,
      entryLine: 9.5,
      closingLine: 10.5,
    });

    expect(result.status).toBe("LINE_MOVED");
    expect(result.clvPct).toBeNull();
    expect(result.impliedDelta).toBeNull();
  });

  it("supports line-free contracts such as 1X2", () => {
    const result = calculateClv({
      entryOdd: 2.4,
      closingOdd: 2.2,
      entryLine: null,
      closingLine: null,
    });

    expect(result.status).toBe("MATCHED");
    expect(result.clvPct).toBeGreaterThan(0);
  });

  it("propagates unavailable source status without inventing CLV", () => {
    const result = calculateClv({
      entryOdd: 2,
      closingOdd: null,
      entryLine: null,
      closingLine: null,
      sourceStatus: "SOURCE_UNAVAILABLE",
    });

    expect(result.status).toBe("SOURCE_UNAVAILABLE");
    expect(result.clvPct).toBeNull();
  });
});
