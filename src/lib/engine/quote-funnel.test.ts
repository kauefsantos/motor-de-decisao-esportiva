import { describe, expect, it } from "vitest";

import {
  MANUAL_QUOTE_BATCH_FIELDS,
  buildManualQuoteBatches,
  buildManualQuoteGroups,
  type FunnelCandidate,
} from "./quote-funnel";

function row(
  predictionId: string,
  matchId: string,
  market: string,
  side: string,
  probabilityExperimental: number,
  participant: string | null = null,
): FunnelCandidate {
  return {
    predictionId,
    matchId,
    family: market.startsWith("corners") ? "CORNERS" : market.startsWith("cards") ? "CARDS" : "GOALS",
    market,
    participant,
    side,
    probabilityExperimental,
    sampleSize: 10,
    trainingMatches: 30,
  };
}

describe("progressive quote funnel", () => {
  it("removes automatically priced rows from the manual queue", () => {
    const candidates = [
      row("a-over", "m1", "corners_match_total", "OVER", 0.62),
      row("a-under", "m1", "corners_match_total", "UNDER", 0.38),
      row("b-over", "m1", "cards_team_total", "OVER", 0.58, "Home"),
      row("b-under", "m1", "cards_team_total", "UNDER", 0.42, "Home"),
    ];

    const groups = buildManualQuoteGroups(candidates, ["a-over", "a-under"]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.predictionIds).toEqual(["b-over", "b-under"]);
  });

  it("never splits a market group and keeps the initial batch bounded", () => {
    const candidates: FunnelCandidate[] = [];
    for (let match = 1; match <= 8; match += 1) {
      candidates.push(
        row(`m${match}-over`, `m${match}`, "corners_team_total", "OVER", 0.56 + match / 100, "Home"),
        row(`m${match}-under`, `m${match}`, "corners_team_total", "UNDER", 0.44 - match / 100, "Home"),
      );
    }

    const batches = buildManualQuoteBatches(candidates, []);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches[0]!.length).toBeLessThanOrEqual(MANUAL_QUOTE_BATCH_FIELDS);
    expect(batches.flat()).toHaveLength(candidates.length);

    for (let match = 1; match <= 8; match += 1) {
      const overBatch = batches.findIndex((batch) => batch.includes(`m${match}-over`));
      const underBatch = batches.findIndex((batch) => batch.includes(`m${match}-under`));
      expect(overBatch).toBe(underBatch);
    }
  });

  it("does not permanently exclude low-priority groups", () => {
    const candidates = [
      row("strong-over", "m1", "goals_match_total", "OVER", 0.8),
      row("strong-under", "m1", "goals_match_total", "UNDER", 0.2),
      row("weak-over", "m2", "goals_match_total", "OVER", 0.51),
      row("weak-under", "m2", "goals_match_total", "UNDER", 0.49),
    ];
    const batches = buildManualQuoteBatches(candidates, [], 2);
    expect(batches).toHaveLength(2);
    expect(batches.flat()).toEqual(expect.arrayContaining(["weak-over", "weak-under"]));
  });
});
