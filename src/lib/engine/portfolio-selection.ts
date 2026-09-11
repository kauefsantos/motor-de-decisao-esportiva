import { passesModelProbabilityGate, type ValueResult } from "./value";

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
 * A linha só chega ao portfólio se já tiver passado pelo gate estrito de
 * probabilidade (>70%), pelo value com odd real e pela execução. Esta checagem
 * é repetida aqui como defesa em profundidade para impedir que um resultado
 * antigo/stale seja promovido apenas por ter EV positivo.
 */
export function selectExperimentalPortfolio<T extends PortfolioCandidate>(
  results: T[],
  limit: number,
): PortfolioSelectionResult<T> {
  const qualified = results
    .filter(
      (row) =>
        row.probabilityStatus === "APROVADA" &&
        passesModelProbabilityGate(row.decisionProbability) &&
        row.valueStatus === "TEM_VALOR" &&
        row.executionStatus === "EXECUTAVEL",
    )
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
