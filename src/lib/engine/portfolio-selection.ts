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
  /** Mantido por compatibilidade de contrato; itens correlacionados não são espelhados ao frontend. */
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
 * Seleciona exclusivamente o portfólio que pode ser espelhado para o frontend.
 * O backend pode avaliar quantos contratos forem necessários; só os sobreviventes
 * desta função chegam à fila principal.
 */
export function selectExperimentalPortfolio<T extends PortfolioCandidate>(
  results: T[],
  legacyLimit = MAX_SELECTIONS,
): PortfolioSelectionResult<T> {
  void legacyLimit;
  const qualified = results.filter(isQualified).sort(valueOrder);
  const selected: T[] = [];
  const selectedMatches = new Set<string>();
  const familyCounts = new Map<string, number>();

  for (const row of qualified) {
    if (selected.length >= MAX_SELECTIONS) break;
    if (row.matchId && selectedMatches.has(row.matchId)) continue;
    const familyCount = familyCounts.get(row.family) ?? 0;
    if (familyCount >= 2) continue;

    selected.push(row);
    if (row.matchId) selectedMatches.add(row.matchId);
    familyCounts.set(row.family, familyCount + 1);
  }

  // Não devolver alternativas ao fluxo operacional evita que a camada de fila
  // reintroduza opções descartadas por correlação, concentração ou top-3.
  return { selected, correlatedAlternates: [] };
}
