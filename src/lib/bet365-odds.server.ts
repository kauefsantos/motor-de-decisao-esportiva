import { fiveDollarGet, type FiveDollarFetch } from "./adapters/five_dollar.server";
import { saoPauloLocalDayUnixWindow } from "./sao-paulo-time";

export type AutoOddsStatus =
  | "MATCHED"
  | "LINE_MISMATCH"
  | "UNSUPPORTED"
  | "NO_PRICE"
  | "SOURCE_UNAVAILABLE";

export type AutoOddsCandidate = {
  predictionId: string;
  market: string;
  side: string | null;
  lineCanonical: number | null;
};

export type AutoOddsMatch = {
  predictionId: string;
  status: AutoOddsStatus;
  odd: number | null;
  offeredLine: number | null;
  stage: "closing" | "opening" | null;
  apiMarket: string | null;
  reason: string;
};

type Row = Record<string, unknown>;
type TotalsApiMarket = "goal_line" | "corner_line" | "card_line";
type SupportedListTotalMarket =
  | "goals_match_total"
  | "corners_match_total"
  | "cards_match_total";

function record(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Row)
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
    if (String(book?.["slug"] ?? "").toLowerCase() !== "bet365") continue;
    return record(book?.["odds"]);
  }
  return null;
}

function preMatchStage(market: Row | null): { stage: "closing" | "opening"; row: Row } | null {
  if (!market) return null;
  const closing = record(market["closing"]);
  if (closing) return { stage: "closing", row: closing };
  const opening = record(market["opening"]);
  if (opening) return { stage: "opening", row: opening };
  return null;
}

function closingStage(market: Row | null): { stage: "closing"; row: Row } | null {
  if (!market) return null;
  const closing = record(market["closing"]);
  return closing ? { stage: "closing", row: closing } : null;
}

function linePrice(
  candidate: AutoOddsCandidate,
  odds: Row,
  apiMarket: TotalsApiMarket,
): AutoOddsMatch {
  const stage = preMatchStage(record(odds[apiMarket]));
  if (!stage) {
    return {
      predictionId: candidate.predictionId,
      status: "NO_PRICE",
      odd: null,
      offeredLine: null,
      stage: null,
      apiMarket,
      reason: "A Bet365 ainda não publicou uma cotação pré-jogo utilizável para este mercado.",
    };
  }

  const offeredLine = finite(stage.row["line"]);
  const requestedLine = candidate.lineCanonical;
  if (offeredLine === null || requestedLine === null || Math.abs(offeredLine - requestedLine) > 1e-9) {
    return {
      predictionId: candidate.predictionId,
      status: "LINE_MISMATCH",
      odd: null,
      offeredLine,
      stage: stage.stage,
      apiMarket,
      reason: `A linha atual da Bet365 (${offeredLine ?? "—"}) difere da linha modelada (${requestedLine ?? "—"}); exige reforecast.`,
    };
  }

  const priceKey = candidate.side === "OVER" ? "over" : candidate.side === "UNDER" ? "under" : null;
  const odd = priceKey ? finite(stage.row[priceKey]) : null;
  if (odd === null || odd <= 1) {
    return {
      predictionId: candidate.predictionId,
      status: "NO_PRICE",
      odd: null,
      offeredLine,
      stage: stage.stage,
      apiMarket,
      reason: "A linha coincide, mas a Bet365 não trouxe um preço pré-jogo válido para este lado.",
    };
  }

  return {
    predictionId: candidate.predictionId,
    status: "MATCHED",
    odd,
    offeredLine,
    stage: stage.stage,
    apiMarket,
    reason: "Preço pré-jogo da Bet365 coletado automaticamente via 5DollarFootballAPI.",
  };
}

function closingLinePrice(
  candidate: AutoOddsCandidate,
  odds: Row,
  apiMarket: TotalsApiMarket,
): AutoOddsMatch {
  const stage = closingStage(record(odds[apiMarket]));
  if (!stage) {
    return {
      predictionId: candidate.predictionId,
      status: "NO_PRICE",
      odd: null,
      offeredLine: null,
      stage: null,
      apiMarket,
      reason: "A Bet365 não expôs um preço de fechamento para este mercado.",
    };
  }

  const offeredLine = finite(stage.row["line"]);
  const requestedLine = candidate.lineCanonical;
  if (offeredLine === null || requestedLine === null || Math.abs(offeredLine - requestedLine) > 1e-9) {
    return {
      predictionId: candidate.predictionId,
      status: "LINE_MISMATCH",
      odd: null,
      offeredLine,
      stage: "closing",
      apiMarket,
      reason: `A linha de fechamento (${offeredLine ?? "—"}) difere da linha aceita (${requestedLine ?? "—"}); CLV de preço não é comparável.`,
    };
  }

  const priceKey = candidate.side === "OVER" ? "over" : candidate.side === "UNDER" ? "under" : null;
  const odd = priceKey ? finite(stage.row[priceKey]) : null;
  return {
    predictionId: candidate.predictionId,
    status: odd !== null && odd > 1 ? "MATCHED" : "NO_PRICE",
    odd: odd !== null && odd > 1 ? odd : null,
    offeredLine,
    stage: "closing",
    apiMarket,
    reason: odd !== null && odd > 1
      ? "Preço de fechamento do mesmo contrato Bet365 coletado via 5DollarFootballAPI."
      : "A linha de fechamento coincide, mas o preço do lado não está disponível.",
  };
}

export function matchBet365Price(candidate: AutoOddsCandidate, payload: unknown): AutoOddsMatch {
  const odds = bookmakerOdds(payload);
  if (!odds) {
    return {
      predictionId: candidate.predictionId,
      status: "SOURCE_UNAVAILABLE",
      odd: null,
      offeredLine: null,
      stage: null,
      apiMarket: null,
      reason: "Resposta sem bloco de odds da Bet365.",
    };
  }

  if (candidate.market === "1x2") {
    const stage = preMatchStage(record(odds["1x2"]));
    const key = candidate.side === "HOME" ? "home" : candidate.side === "DRAW" ? "draw" : candidate.side === "AWAY" ? "away" : null;
    const odd = stage && key ? finite(stage.row[key]) : null;
    return {
      predictionId: candidate.predictionId,
      status: odd !== null && odd > 1 ? "MATCHED" : "NO_PRICE",
      odd: odd !== null && odd > 1 ? odd : null,
      offeredLine: null,
      stage: stage?.stage ?? null,
      apiMarket: "1x2",
      reason: odd !== null && odd > 1
        ? "Preço pré-jogo 1X2 da Bet365 coletado automaticamente via 5DollarFootballAPI."
        : "Sem preço pré-jogo 1X2 válido para este lado.",
    };
  }

  if (candidate.market === "btts") {
    const stage = preMatchStage(record(odds["btts"]));
    const key = candidate.side === "YES" ? "yes" : candidate.side === "NO" ? "no" : null;
    const odd = stage && key ? finite(stage.row[key]) : null;
    return {
      predictionId: candidate.predictionId,
      status: odd !== null && odd > 1 ? "MATCHED" : "NO_PRICE",
      odd: odd !== null && odd > 1 ? odd : null,
      offeredLine: null,
      stage: stage?.stage ?? null,
      apiMarket: "btts",
      reason: odd !== null && odd > 1
        ? "Preço pré-jogo BTTS da Bet365 coletado automaticamente via 5DollarFootballAPI."
        : "Sem preço pré-jogo BTTS válido para este lado.",
    };
  }

  if (candidate.market === "goals_match_total") return linePrice(candidate, odds, "goal_line");
  if (candidate.market === "corners_match_total") return linePrice(candidate, odds, "corner_line");
  if (candidate.market === "cards_match_total") return linePrice(candidate, odds, "card_line");

  return {
    predictionId: candidate.predictionId,
    status: "UNSUPPORTED",
    odd: null,
    offeredLine: null,
    stage: null,
    apiMarket: null,
    reason: "A 5Dollar Pro não expõe o preço Bet365 deste contrato específico; entrada manual continua disponível.",
  };
}

/**
 * Closing-only matcher for CLV. Unlike matchBet365Price this function never
 * falls back to opening, because an opening quote is not a closing benchmark.
 */
export function matchBet365ClosingPrice(candidate: AutoOddsCandidate, payload: unknown): AutoOddsMatch {
  const odds = bookmakerOdds(payload);
  if (!odds) {
    return {
      predictionId: candidate.predictionId,
      status: "SOURCE_UNAVAILABLE",
      odd: null,
      offeredLine: null,
      stage: null,
      apiMarket: null,
      reason: "Resposta sem bloco de odds da Bet365.",
    };
  }

  if (candidate.market === "1x2") {
    const stage = closingStage(record(odds["1x2"]));
    const key = candidate.side === "HOME" ? "home" : candidate.side === "DRAW" ? "draw" : candidate.side === "AWAY" ? "away" : null;
    const odd = stage && key ? finite(stage.row[key]) : null;
    return {
      predictionId: candidate.predictionId,
      status: odd !== null && odd > 1 ? "MATCHED" : "NO_PRICE",
      odd: odd !== null && odd > 1 ? odd : null,
      offeredLine: null,
      stage: stage ? "closing" : null,
      apiMarket: "1x2",
      reason: odd !== null && odd > 1
        ? "Preço de fechamento 1X2 da Bet365 coletado via 5DollarFootballAPI."
        : "Sem preço de fechamento 1X2 válido para este lado.",
    };
  }

  if (candidate.market === "goals_match_total") return closingLinePrice(candidate, odds, "goal_line");
  if (candidate.market === "corners_match_total") return closingLinePrice(candidate, odds, "corner_line");
  if (candidate.market === "cards_match_total") return closingLinePrice(candidate, odds, "card_line");

  return {
    predictionId: candidate.predictionId,
    status: "UNSUPPORTED",
    odd: null,
    offeredLine: null,
    stage: null,
    apiMarket: null,
    reason: "Este contrato não possui preço de fechamento Bet365 equivalente no parser atual.",
  };
}

export function matchBet365List1x2(candidate: AutoOddsCandidate, embeddedOdds: unknown): AutoOddsMatch {
  const payload = {
    data: {
      bookmakers: [{ slug: "bet365", odds: embeddedOdds }],
    },
  };
  return matchBet365Price(candidate, payload);
}

function listApiMarket(market: SupportedListTotalMarket): TotalsApiMarket {
  if (market === "goals_match_total") return "goal_line";
  if (market === "corners_match_total") return "corner_line";
  return "card_line";
}

export function bet365ListOfferedLine(
  embeddedOdds: unknown,
  market: SupportedListTotalMarket,
): number | null {
  const odds = record(embeddedOdds);
  const apiMarket = listApiMarket(market);
  const row = record(odds?.[apiMarket]);
  if (!row) return null;
  // No feed diário Pro as linhas de totais são números, não os pares de preços.
  return finite(row["closing"] ?? row["opening"]);
}

function hasMore(payload: unknown): boolean {
  const pagination = record(record(payload)?.["pagination"]);
  return pagination?.["has_more"] === true;
}

export async function fetchBet365DayOdds(isoDate: string): Promise<{
  oddsByFixture: Map<number, unknown>;
  fetches: FiveDollarFetch[];
}> {
  const { start, end } = saoPauloLocalDayUnixWindow(isoDate);
  const oddsByFixture = new Map<number, unknown>();
  const fetches: FiveDollarFetch[] = [];

  for (let page = 1; page <= 20; page += 1) {
    const fetched = await fiveDollarGet(
      `/fixtures?start_time=${start}&end_time=${end}&include=odds&page=${page}&per_page=50`,
    );
    fetches.push(fetched);
    if (fetched.status !== "OK" || fetched.payload === null) break;
    const root = record(fetched.payload);
    const data = Array.isArray(root?.["data"]) ? root!["data"] as unknown[] : [];
    for (const item of data) {
      const fixture = record(item);
      const id = finite(fixture?.["id"]);
      if (id !== null) oddsByFixture.set(id, fixture?.["odds"] ?? null);
    }
    if (!hasMore(fetched.payload)) break;
  }

  return { oddsByFixture, fetches };
}

export async function fetchBet365FixtureOdds(fixtureId: number): Promise<FiveDollarFetch> {
  return fiveDollarGet(`/fixtures/${fixtureId}/odds?bookmakers=bet365`);
}
