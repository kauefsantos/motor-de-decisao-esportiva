import {
  EV_TARGET,
  MIN_EDGE,
  MAX_SELECTIONS,
  passesMinimumOddGate,
  passesModelProbabilityGate,
  type ValueResult,
} from "./value";

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

function isQualified(row: ValueResult) {
  return row.probabilityStatus === "APROVADA" &&
    passesModelProbabilityGate(row.decisionProbability) &&
    passesMinimumOddGate(row.odd) &&
    (row.evCons ?? -Infinity) >= EV_TARGET &&
    (row.edgeCons ?? -Infinity) >= MIN_EDGE &&
    row.valueStatus === "TEM_VALOR" &&
    row.executionStatus === "EXECUTAVEL";
}

/**
 * Seleciona o portfólio que pode ser espelhado para o frontend.
 *
 * Defesa em profundidade:
 * - repete todos os gates quantitativos do Motor 2;
 * - no máximo uma seleção principal por partida;
 * - no máximo duas seleções da mesma família entre as três finais;
 * - nunca força quantidade: zero é um resultado válido.
 */
export function selectExperimentalPortfolio<T extends PortfolioCandidate>(
  results: T[],
  limit = MAX_SELECTIONS,
): PortfolioSelectionResult<T> {
  const effectiveLimit = Math.max(0, Math.min(limit, MAX_SELECTIONS));
  const qualified = results.filter(isQualified).sort(valueOrder);

  const selected: T[] = [];
  const correlatedAlternates: T[] = [];
  const selectedMatches = new Set<string>();
  const familyCounts = new Map<string, number>();

  for (const row of qualified) {
    if (selected.length >= effectiveLimit) {
      correlatedAlternates.push(row);
      continue;
    }
    if (row.matchId && selectedMatches.has(row.matchId)) {
      correlatedAlternates.push(row);
      continue;
    }
    const familyCount = familyCounts.get(row.family) ?? 0;
    if (familyCount >= 2) {
      correlatedAlternates.push(row);
      continue;
    }
    selected.push(row);
    if (row.matchId) selectedMatches.add(row.matchId);
    familyCounts.set(row.family, familyCount + 1);
  }

  return { selected, correlatedAlternates };
}
