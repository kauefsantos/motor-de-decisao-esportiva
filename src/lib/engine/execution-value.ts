import { distributionFromStoredOutcome } from "./count-market-distribution";
import { isTotalsMarket } from "./market-policy";
import { asianOutcomes } from "./settlement";
import type { AsianOutcomeProbabilities, ContractType } from "./types";

export type ExecutionValueContract = {
  contractType: ContractType;
  outcomeDistribution: AsianOutcomeProbabilities | null;
};

/**
 * Resolves the settlement contract used by the value engine from the immutable
 * prediction payload. Totals always use the Asian settlement path, even on
 * half-lines, so a future integer/quarter line cannot silently fall back to a
 * binary EV formula.
 */
export function executionValueContract(input: {
  market: string;
  side: string | null;
  lineCanonical: number | null;
  storedOutcomeDistribution: unknown;
}): ExecutionValueContract {
  if (!isTotalsMarket(input.market)) {
    return { contractType: "BINARY", outcomeDistribution: null };
  }

  if (
    input.lineCanonical === null ||
    (input.side !== "OVER" && input.side !== "UNDER")
  ) {
    return { contractType: "ASIAN", outcomeDistribution: null };
  }

  const countDistribution = distributionFromStoredOutcome(input.storedOutcomeDistribution);
  if (!countDistribution) {
    return { contractType: "ASIAN", outcomeDistribution: null };
  }

  return {
    contractType: "ASIAN",
    outcomeDistribution: asianOutcomes(
      countDistribution,
      input.lineCanonical,
      input.side,
    ),
  };
}
