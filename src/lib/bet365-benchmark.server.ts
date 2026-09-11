import type { AutoOddsCandidate, AutoOddsMatch } from "./bet365-odds.server";

type Row = Record<string, unknown>;

type TotalsApiMarket = "goal_line" | "corner_line" | "card_line";

function record(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Row
    : null;
}

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function bookmakerOdds(payload: unknown): Row | null {
  const root = record(payload);
  const data = record(root?.["data"]);
  const books = Array.isArray(data?.["bookmakers"]) ? data!["bookmakers"] as unknown[] : [];
  for (const item of books) {
    const book = record(item);
    if (String(book?.["slug"] ?? "").toLowerCase() === "bet365") return record(book?.["odds"]);
  }
  return null;
}

function openingTotal(
  candidate: AutoOddsCandidate,
  odds: Row,
  apiMarket: TotalsApiMarket,
): AutoOddsMatch {
  const market = record(odds[apiMarket]);
  const opening = record(market?.["opening"]);
  if (!opening) {
    return { predictionId: candidate.predictionId, status: "NO_PRICE", odd: null, offeredLine: null, stage: null, apiMarket, reason: "Sem snapshot de abertura Bet365 para este mercado." };
  }
  const line = finite(opening["line"]);
  const priceKey = candidate.side === "OVER" ? "over" : candidate.side === "UNDER" ? "under" : null;
  const odd = priceKey ? finite(opening[priceKey]) : null;
  return {
    predictionId: candidate.predictionId,
    status: odd !== null && odd > 1 ? "MATCHED" : "NO_PRICE",
    odd: odd !== null && odd > 1 ? odd : null,
    offeredLine: line,
    stage: "opening",
    apiMarket,
    reason: odd !== null && odd > 1 ? "Snapshot de abertura Bet365 coletado via 5DollarFootballAPI." : "Linha de abertura disponível, mas sem preço válido deste lado.",
  };
}

/** Opening is diagnostic only; it is never substituted for a missing closing price. */
export function matchBet365OpeningPrice(candidate: AutoOddsCandidate, payload: unknown): AutoOddsMatch {
  const odds = bookmakerOdds(payload);
  if (!odds) {
    return { predictionId: candidate.predictionId, status: "SOURCE_UNAVAILABLE", odd: null, offeredLine: null, stage: null, apiMarket: null, reason: "Resposta sem bloco de odds Bet365." };
  }

  if (candidate.market === "1x2") {
    const opening = record(record(odds["1x2"])?.["opening"]);
    const key = candidate.side === "HOME" ? "home" : candidate.side === "DRAW" ? "draw" : candidate.side === "AWAY" ? "away" : null;
    const odd = opening && key ? finite(opening[key]) : null;
    return {
      predictionId: candidate.predictionId,
      status: odd !== null && odd > 1 ? "MATCHED" : "NO_PRICE",
      odd: odd !== null && odd > 1 ? odd : null,
      offeredLine: null,
      stage: opening ? "opening" : null,
      apiMarket: "1x2",
      reason: odd !== null && odd > 1 ? "Snapshot de abertura 1X2 Bet365 coletado via 5DollarFootballAPI." : "Sem preço de abertura 1X2 válido.",
    };
  }

  if (candidate.market === "goals_match_total") return openingTotal(candidate, odds, "goal_line");
  if (candidate.market === "corners_match_total") return openingTotal(candidate, odds, "corner_line");
  if (candidate.market === "cards_match_total") return openingTotal(candidate, odds, "card_line");

  return { predictionId: candidate.predictionId, status: "UNSUPPORTED", odd: null, offeredLine: null, stage: null, apiMarket: null, reason: "Contrato sem benchmark de abertura equivalente no parser atual." };
}
