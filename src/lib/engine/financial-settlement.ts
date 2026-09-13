import { isTotalsMarket } from "./market-policy";

export const FINANCIAL_SETTLEMENT_OUTCOMES = [
  "WIN",
  "HALF_WIN",
  "PUSH",
  "HALF_LOSS",
  "LOSS",
  "VOID",
] as const;

export type FinancialSettlementOutcome = (typeof FINANCIAL_SETTLEMENT_OUTCOMES)[number];

const EPS = 1e-9;

export function settlementProfitUnits(outcome: FinancialSettlementOutcome, odd: number) {
  if (!(odd > 1) || !Number.isFinite(odd)) return null;
  if (outcome === "WIN") return odd - 1;
  if (outcome === "HALF_WIN") return (odd - 1) / 2;
  if (outcome === "PUSH" || outcome === "VOID") return 0;
  if (outcome === "HALF_LOSS") return -0.5;
  return -1;
}

export function allowedFinancialSettlementOutcomes(input: {
  market: string;
  lineCanonical: number | null;
  side: string | null;
}): FinancialSettlementOutcome[] {
  const { market, lineCanonical, side } = input;
  if (
    !isTotalsMarket(market) ||
    lineCanonical === null ||
    (side !== "OVER" && side !== "UNDER")
  ) {
    return ["WIN", "LOSS", "VOID"];
  }

  const fraction = Math.abs(lineCanonical - Math.floor(lineCanonical));
  if (Math.abs(fraction) < EPS || Math.abs(fraction - 1) < EPS) {
    return ["WIN", "PUSH", "LOSS", "VOID"];
  }
  if (Math.abs(fraction - 0.25) < EPS) {
    return side === "OVER"
      ? ["WIN", "HALF_LOSS", "LOSS", "VOID"]
      : ["WIN", "HALF_WIN", "LOSS", "VOID"];
  }
  if (Math.abs(fraction - 0.75) < EPS) {
    return side === "OVER"
      ? ["WIN", "HALF_WIN", "LOSS", "VOID"]
      : ["WIN", "HALF_LOSS", "LOSS", "VOID"];
  }
  return ["WIN", "LOSS", "VOID"];
}
