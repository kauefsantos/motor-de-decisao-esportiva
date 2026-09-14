export type ConfirmationCandidate = {
  predictionId: string;
  lineCanonical: number | null;
};

export type ConfirmationQuote = {
  predictionId: string;
  status: "MATCHED" | "LINE_MISMATCH" | "UNSUPPORTED" | "NO_PRICE" | "SOURCE_UNAVAILABLE";
  odd: number | null;
};

export type ConfirmedQuoteEntry = {
  predictionId: string;
  odd: number;
  lineAtEntry: number | null;
};

function parseOdd(value: string | undefined): number | null {
  if (!value) return null;
  const odd = Number(value.replace(",", "."));
  return Number.isFinite(odd) && odd > 1 ? odd : null;
}

/**
 * Confirmation rule:
 * - a fresh automatic Bet365 quote always wins for automatically supported contracts;
 * - manual input is only used when the fresh API response is not MATCHED;
 * - stale automatic prices are never carried into the final value calculation;
 * - the modeled line remains frozen and is sent as lineAtEntry.
 */
export function buildConfirmedQuoteEntries(
  candidates: ConfirmationCandidate[],
  refreshedQuotes: ConfirmationQuote[],
  manualOdds: Record<string, string>,
): ConfirmedQuoteEntry[] {
  const quoteByPrediction = new Map(refreshedQuotes.map((quote) => [quote.predictionId, quote]));
  const entries: ConfirmedQuoteEntry[] = [];

  for (const candidate of candidates) {
    const quote = quoteByPrediction.get(candidate.predictionId);
    const freshAutomatic = quote?.status === "MATCHED" && quote.odd !== null && quote.odd > 1
      ? quote.odd
      : null;
    const manual = freshAutomatic === null ? parseOdd(manualOdds[candidate.predictionId]) : null;
    const odd = freshAutomatic ?? manual;
    if (odd === null) continue;

    entries.push({
      predictionId: candidate.predictionId,
      odd,
      lineAtEntry: candidate.lineCanonical,
    });
  }

  return entries;
}
