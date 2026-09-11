import type { ValueResult } from "./value";

export type PortfolioCandidate = ValueResult & {
  matchId: string | null;
  family: string;
  market: string;
  participant: string | null;
  side: string | null;
};

export type PortfolioSelectionResult<T extends PortfolioCandidate> = {
  selected: T[];
  correlatedAlternates: T[];
};

function valueOrder<T extends ValueResult>(a: T, b: T) {
  return (b.evCons ?? -Infinity) - (a.evCons ?? -Infinity) ||
    (b.edgeCons ?? -Infinity) - (a.edgeCons ?? -Infinity);
}

/**
 * Experimental portfolio selector.
 *
 * Value is still decided per contract. This layer only avoids concentrating the
 * automatic final card in the same fixture. Positive-EV rows skipped by this
 * rule remain qualified alternates and can still be inspected/manually chosen.
 */
export function selectExperimentalPortfolio<T extends PortfolioCandidate>(
  results: T[],
  limit: number,
): PortfolioSelectionResult<T> {
  const qualified = results
    .filter((row) => row.valueStatus === "TEM_VALOR" && row.executionStatus === "EXECUTAVEL")
    .sort(valueOrder);

  const selected: T[] = [];
  const correlatedAlternates: T[] = [];
  const selectedMatches = new Set<string>();

  for (const row of qualified) {
    if (selected.length >= limit) {
      correlatedAlternates.push(row);
      continue;
    }
    if (row.matchId && selectedMatches.has(row.matchId)) {
      correlatedAlternates.push(row);
      continue;
    }
    selected.push(row);
    if (row.matchId) selectedMatches.add(row.matchId);
  }

  return { selected, correlatedAlternates };
}
