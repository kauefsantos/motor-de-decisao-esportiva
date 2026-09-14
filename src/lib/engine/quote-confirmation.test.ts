import { describe, expect, it } from "vitest";

import { buildConfirmedQuoteEntries } from "./quote-confirmation";

const candidates = [
  { predictionId: "auto", lineCanonical: 2.5 },
  { predictionId: "manual", lineCanonical: 4.5 },
  { predictionId: "missing", lineCanonical: null },
];

describe("quote confirmation", () => {
  it("always prefers the refreshed automatic price over a manual/stale value", () => {
    const entries = buildConfirmedQuoteEntries(
      candidates,
      [
        { predictionId: "auto", status: "MATCHED", odd: 1.92 },
        { predictionId: "manual", status: "UNSUPPORTED", odd: null },
        { predictionId: "missing", status: "NO_PRICE", odd: null },
      ],
      { auto: "2,50", manual: "1,84" },
    );

    expect(entries).toEqual([
      { predictionId: "auto", odd: 1.92, lineAtEntry: 2.5 },
      { predictionId: "manual", odd: 1.84, lineAtEntry: 4.5 },
    ]);
  });

  it("never carries an unavailable automatic quote forward as if it were fresh", () => {
    const entries = buildConfirmedQuoteEntries(
      [{ predictionId: "changed", lineCanonical: 9.5 }],
      [{ predictionId: "changed", status: "LINE_MISMATCH", odd: null }],
      {},
    );

    expect(entries).toEqual([]);
  });

  it("accepts comma decimal input only for contracts that still need manual pricing", () => {
    const entries = buildConfirmedQuoteEntries(
      [{ predictionId: "team-cards", lineCanonical: 4.5 }],
      [{ predictionId: "team-cards", status: "UNSUPPORTED", odd: null }],
      { "team-cards": "1,73" },
    );

    expect(entries).toEqual([
      { predictionId: "team-cards", odd: 1.73, lineAtEntry: 4.5 },
    ]);
  });
});
