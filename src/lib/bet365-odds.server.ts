import { fiveDollarGet, type FiveDollarFetch } from "./adapters/five_dollar.server";

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

function linePrice(
  candidate: AutoOddsCandidate,
  odds: Row,
  apiMarket: "goal_line" | "corner_line",
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

  if (candidate.market === "goals_match_total") {
    return linePrice(candidate, odds, "goal_line");
  }

  if (candidate.market === "corners_match_total") {
    return linePrice(candidate, odds, "corner_line");
  }

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

export async function fetchBet365FixtureOdds(fixtureId: number): Promise<FiveDollarFetch> {
  return fiveDollarGet(`/fixtures/${fixtureId}/odds?bookmakers=bet365`);
}
