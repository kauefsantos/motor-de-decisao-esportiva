import { describe, expect, it } from "vitest";

import {
  allowedFinancialSettlementOutcomes,
  settlementProfitUnits,
} from "./financial-settlement";

describe("financial settlement", () => {
  it("prices full, half, push and void outcomes from the executed odd", () => {
    expect(settlementProfitUnits("WIN", 2)).toBe(1);
    expect(settlementProfitUnits("HALF_WIN", 2)).toBe(0.5);
    expect(settlementProfitUnits("PUSH", 2)).toBe(0);
    expect(settlementProfitUnits("HALF_LOSS", 2)).toBe(-0.5);
    expect(settlementProfitUnits("LOSS", 2)).toBe(-1);
    expect(settlementProfitUnits("VOID", 2)).toBe(0);
  });

  it("exposes only feasible results for integer and half lines", () => {
    expect(allowedFinancialSettlementOutcomes({
      market: "goals_match_total",
      lineCanonical: 2,
      side: "OVER",
    })).toEqual(["WIN", "PUSH", "LOSS", "VOID"]);
    expect(allowedFinancialSettlementOutcomes({
      market: "goals_match_total",
      lineCanonical: 2.5,
      side: "UNDER",
    })).toEqual(["WIN", "LOSS", "VOID"]);
  });

  it("maps quarter-line half outcomes to the correct side", () => {
    expect(allowedFinancialSettlementOutcomes({
      market: "corners_match_total",
      lineCanonical: 9.25,
      side: "OVER",
    })).toEqual(["WIN", "HALF_LOSS", "LOSS", "VOID"]);
    expect(allowedFinancialSettlementOutcomes({
      market: "corners_match_total",
      lineCanonical: 9.25,
      side: "UNDER",
    })).toEqual(["WIN", "HALF_WIN", "LOSS", "VOID"]);
    expect(allowedFinancialSettlementOutcomes({
      market: "cards_match_total",
      lineCanonical: 4.75,
      side: "OVER",
    })).toEqual(["WIN", "HALF_WIN", "LOSS", "VOID"]);
    expect(allowedFinancialSettlementOutcomes({
      market: "cards_match_total",
      lineCanonical: 4.75,
      side: "UNDER",
    })).toEqual(["WIN", "HALF_LOSS", "LOSS", "VOID"]);
  });
});
