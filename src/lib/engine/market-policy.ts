export type TotalsMarket =
  | "corners_match_total"
  | "corners_team_total"
  | "goals_match_total"
  | "cards_match_total"
  | "cards_team_total";

export type TotalsSide = "OVER" | "UNDER";

export type TotalsPolicy = {
  anchor: number;
  over: readonly number[];
  under: readonly number[];
};

export const EXPERIMENTAL_MARKET_POLICY_VERSION = "MP2";

export const EXPERIMENTAL_TOTAL_MARKET_POLICY: Record<TotalsMarket, TotalsPolicy> = {
  corners_match_total: {
    anchor: 9.5,
    over: [9.5, 10.5],
    under: [9.5, 8.5, 7.5, 6.5],
  },
  corners_team_total: {
    anchor: 4.5,
    over: [4.5, 5.5, 6.5, 7.5],
    under: [4.5, 3.5, 2.5],
  },
  goals_match_total: {
    anchor: 2.5,
    over: [2.5, 3.5],
    under: [2.5, 1.5],
  },
  cards_match_total: {
    anchor: 4.5,
    over: [4.5, 5.5, 6.5],
    under: [4.5, 3.5, 2.5],
  },
  cards_team_total: {
    anchor: 4.5,
    over: [4.5, 5.5, 6.5],
    under: [4.5, 3.5, 2.5],
  },
};

const OUTCOME_SIDES: Record<string, readonly string[]> = {
  "1x2": ["HOME", "DRAW", "AWAY"],
  double_chance: ["1X", "X2", "12"],
};

export const EXPERIMENTAL_QUOTE_CANDIDATES_PER_COMPLETE_MATCH = 20;
/**
 * Regra operacional de confiança: 70,0% ainda reprova; só >70% pode ser
 * considerado direção forte/recomendação. A avaliação de value continua
 * separada e exige odd real + EV alvo.
 */
export const MODEL_LEAN_THRESHOLD = 0.70;

export function passesExperimentalModelGate(probability: number | null | undefined): boolean {
  return probability !== null && probability !== undefined && Number.isFinite(probability) && probability > MODEL_LEAN_THRESHOLD && probability <= 1;
}

export function isTotalsMarket(market: string): market is TotalsMarket {
  return market in EXPERIMENTAL_TOTAL_MARKET_POLICY;
}

export function totalsPolicyFor(market: string): TotalsPolicy | null {
  return isTotalsMarket(market) ? EXPERIMENTAL_TOTAL_MARKET_POLICY[market] : null;
}

export function quoteAnchorFor(market: string): number | null {
  return totalsPolicyFor(market)?.anchor ?? null;
}

export function ladderFor(market: string, side: string | null): readonly number[] {
  const policy = totalsPolicyFor(market);
  if (!policy) return [];
  if (side === "OVER") return policy.over;
  if (side === "UNDER") return policy.under;
  return [];
}

export function referenceLinesFor(market: string, side: string | null): readonly number[] {
  const policy = totalsPolicyFor(market);
  if (!policy) return [];
  return ladderFor(market, side).filter((line) => Math.abs(line - policy.anchor) > 1e-9);
}

export function isAllowedExperimentalContract(input: {
  market: string;
  side: string | null;
  lineCanonical: number | null;
}): boolean {
  const outcomeSides = OUTCOME_SIDES[input.market];
  if (outcomeSides) {
    return input.lineCanonical === null && input.side !== null && outcomeSides.includes(input.side);
  }
  if (input.side !== "OVER" && input.side !== "UNDER") return false;
  if (input.lineCanonical === null) return false;
  return ladderFor(input.market, input.side).some(
    (line) => Math.abs(line - input.lineCanonical!) <= 1e-9,
  );
}

export function isQuoteAnchorPrediction(input: {
  market: string;
  side: string | null;
  lineCanonical: number | null;
}): boolean {
  const outcomeSides = OUTCOME_SIDES[input.market];
  if (outcomeSides) {
    return input.lineCanonical === null && input.side !== null && outcomeSides.includes(input.side);
  }

  const anchor = quoteAnchorFor(input.market);
  if (anchor === null || (input.side !== "OVER" && input.side !== "UNDER")) return false;
  return input.lineCanonical !== null && Math.abs(input.lineCanonical - anchor) <= 1e-9;
}

export function filterQuoteAnchorPredictions<T extends {
  market: string;
  side: string | null;
  line_canonical: number | string | null;
}>(rows: T[]): T[] {
  return rows.filter((row) =>
    isQuoteAnchorPrediction({
      market: row.market,
      side: row.side,
      lineCanonical: row.line_canonical === null ? null : Number(row.line_canonical),
    }),
  );
}

function fnv1a64(value: string): string {
  let hash = 14695981039346656037n;
  const prime = 1099511628211n;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

/** Immutable experimental identity: policy version + exact contract, never ordinal. */
export function experimentalPredictionId(input: {
  runId: string;
  matchId: string;
  family: string;
  market: string;
  participant: string | null;
  side: string | null;
  lineCanonical: number | null;
}): string {
  const contractKey = [
    EXPERIMENTAL_MARKET_POLICY_VERSION,
    input.family,
    input.market,
    input.participant ?? "MATCH",
    input.side ?? "NONE",
    input.lineCanonical === null ? "NO_LINE" : input.lineCanonical.toFixed(4),
  ].join("|");
  return `EXP-${EXPERIMENTAL_MARKET_POLICY_VERSION}-${input.family}-${input.runId.slice(0, 6)}-${input.matchId.slice(0, 6)}-${fnv1a64(contractKey)}`;
}

export function formatBookmakerLine(line: number): string {
  return line.toFixed(1).replace(".", ",");
}

export function expectedQuoteCandidateCount(input: {
  corners: boolean;
  cards: boolean;
  goals: boolean;
}): number {
  return (input.corners ? 6 : 0) + (input.cards ? 6 : 0) + (input.goals ? 8 : 0);
}
