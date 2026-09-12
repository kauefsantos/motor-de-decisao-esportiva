import { describe, expect, it } from "vitest";

import {
  EXPERIMENTAL_MARKET_POLICY_VERSION,
  EXPERIMENTAL_QUOTE_CANDIDATES_PER_COMPLETE_MATCH,
  EXPERIMENTAL_TOTAL_MARKET_POLICY,
  MODEL_LEAN_THRESHOLD,
  expectedQuoteCandidateCount,
  experimentalPredictionId,
  filterQuoteAnchorPredictions,
  isAllowedExperimentalContract,
  isQuoteAnchorPrediction,
  passesExperimentalModelGate,
  referenceLinesFor,
} from "./market-policy";

describe("experimental market policy", () => {
  it("keeps an inclusive confidence gate at 70%", () => {
    expect(MODEL_LEAN_THRESHOLD).toBe(0.70);
    expect(passesExperimentalModelGate(0.6999)).toBe(false);
    expect(passesExperimentalModelGate(0.70)).toBe(true);
    expect(passesExperimentalModelGate(0.701)).toBe(true);
    expect(passesExperimentalModelGate(0.33)).toBe(false);
  });

  it("keeps the requested anchor lines and bounded ladders", () => {
    expect(EXPERIMENTAL_TOTAL_MARKET_POLICY.corners_match_total).toEqual({ anchor: 9.5, over: [9.5, 10.5], under: [9.5, 8.5, 7.5, 6.5] });
    expect(EXPERIMENTAL_TOTAL_MARKET_POLICY.corners_team_total).toEqual({ anchor: 4.5, over: [4.5, 5.5, 6.5, 7.5], under: [4.5, 3.5, 2.5] });
    expect(EXPERIMENTAL_TOTAL_MARKET_POLICY.goals_match_total).toEqual({ anchor: 2.5, over: [2.5, 3.5], under: [2.5, 1.5] });
    expect(EXPERIMENTAL_TOTAL_MARKET_POLICY.cards_match_total).toEqual({ anchor: 4.5, over: [4.5, 5.5, 6.5], under: [4.5, 3.5, 2.5] });
    expect(EXPERIMENTAL_TOTAL_MARKET_POLICY.cards_team_total).toEqual({ anchor: 4.5, over: [4.5, 5.5, 6.5], under: [4.5, 3.5, 2.5] });
  });

  it("caps a complete modeled match at 20 quote candidates", () => {
    expect(EXPERIMENTAL_QUOTE_CANDIDATES_PER_COMPLETE_MATCH).toBe(20);
    expect(expectedQuoteCandidateCount({ corners: true, cards: true, goals: true })).toBe(20);
  });

  it("never exposes reference ladder lines as quote anchors", () => {
    for (const [market, policy] of Object.entries(EXPERIMENTAL_TOTAL_MARKET_POLICY)) {
      for (const side of ["OVER", "UNDER"] as const) {
        for (const line of referenceLinesFor(market, side)) {
          expect(isQuoteAnchorPrediction({ market, side, lineCanonical: line })).toBe(false);
          expect(isAllowedExperimentalContract({ market, side, lineCanonical: line })).toBe(true);
        }
        expect(isQuoteAnchorPrediction({ market, side, lineCanonical: policy.anchor })).toBe(true);
      }
    }
  });

  it("keeps quote-anchor discovery independent from the final probability gate", () => {
    const rows = [
      { market: "goals_match_total", side: "OVER", line_canonical: 2.5, model_probability: 0.55 },
      { market: "goals_match_total", side: "UNDER", line_canonical: 2.5, model_probability: 0.45 },
      { market: "goals_match_total", side: "OVER", line_canonical: 3.5, model_probability: 0.20 },
      { market: "1x2", side: "HOME", line_canonical: null, model_probability: 0.40 },
      { market: "double_chance", side: "1X", line_canonical: null, model_probability: 0.70 },
      { market: "btts", side: "YES", line_canonical: null, model_probability: 0.75 },
    ];
    expect(filterQuoteAnchorPredictions(rows)).toEqual([rows[0], rows[1], rows[3], rows[4]]);
  });

  it("uses policy-versioned exact-contract IDs instead of ordinals", () => {
    const base = {
      runId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      matchId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      family: "CORNERS",
      market: "corners_match_total",
      participant: null,
      side: "OVER",
      lineCanonical: 9.5,
    };
    const id = experimentalPredictionId(base);
    expect(id).toContain(`EXP-${EXPERIMENTAL_MARKET_POLICY_VERSION}-CORNERS-`);
    expect(experimentalPredictionId(base)).toBe(id);
    expect(experimentalPredictionId({ ...base, lineCanonical: 10.5 })).not.toBe(id);
    expect(experimentalPredictionId({ ...base, side: "UNDER" })).not.toBe(id);
  });
});
