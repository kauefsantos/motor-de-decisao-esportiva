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
export const MODEL_LEAN_THRESHOLD = 0.55;

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
