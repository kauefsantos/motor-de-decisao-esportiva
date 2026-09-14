import type { AdminDb } from "./admin-db";
import {
  bet365ListOfferedLine,
  fetchBet365DayOdds,
  fetchBet365FixtureOdds,
  matchBet365List1x2,
  matchBet365Price,
  type AutoOddsCandidate,
  type AutoOddsMatch,
} from "./bet365-odds.server";
import { familyForMarket } from "./engine/experimental-goal-markets";
import { filterQuoteAnchorPredictions, passesExperimentalModelGate } from "./engine/market-policy";
import { buildManualQuoteBatches } from "./engine/quote-funnel";
import { captureFiveDollarLeaguePriorsForRun } from "./five-dollar-priors.server";

const EXPERIMENTAL_STATUS = "EXPERIMENTAL_CURRENT_SEASON";
const DIRECT_MARKETS = new Set([
  "1x2",
  "goals_match_total",
  "corners_match_total",
  "cards_match_total",
]);

type PredictionRow = {
  prediction_id: string;
  match_id: string;
  market: string;
  participant: string | null;
  side: string | null;
  line_canonical: number | string | null;
  model_probability: number | string | null;
};

type ExternalIdRow = { match_id: string; external_id: string };
type MatchRow = { id: string; raw_partida: string; home_team: string | null; away_team: string | null };
export type QuoteWithMatch = AutoOddsMatch & { matchId: string; matchLabel: string };

export type AutomaticOddsCollection = {
  quotes: QuoteWithMatch[];
  matched: number;
  lineMismatch: number;
  unsupported: number;
  noPrice: number;
  sourceUnavailable: number;
  fixturesRequested: number;
  dayPagesRequested: number;
  manualBatches: string[][];
  manualFieldCount: number;
  automaticallyPricedPredictionIds: string[];
  priorCapture: Awaited<ReturnType<typeof captureFiveDollarLeaguePriorsForRun>> | null;
  message: string;
};

function label(match: MatchRow | undefined) {
  if (!match) return "—";
  return match.home_team && match.away_team ? `${match.home_team} x ${match.away_team}` : match.raw_partida;
}

function candidateFromRow(row: PredictionRow): AutoOddsCandidate {
  return {
    predictionId: row.prediction_id,
    market: row.market,
    side: row.side,
    lineCanonical: row.line_canonical === null ? null : Number(row.line_canonical),
  };
}

function apiMarketFor(row: PredictionRow): string | null {
  if (row.market === "goals_match_total") return "goal_line";
  if (row.market === "corners_match_total") return "corner_line";
  if (row.market === "cards_match_total") return "card_line";
  if (row.market === "1x2") return "1x2";
  return null;
}

function unsupported(row: PredictionRow): AutoOddsMatch {
  return {
    predictionId: row.prediction_id,
    status: "UNSUPPORTED",
    odd: null,
    offeredLine: null,
    stage: null,
    apiMarket: null,
    reason: "A 5Dollar Pro não expõe diretamente este contrato Bet365; o campo continua disponível para entrada manual.",
  };
}

function lineMismatch(row: PredictionRow, offeredLine: number): AutoOddsMatch {
  return {
    predictionId: row.prediction_id,
    status: "LINE_MISMATCH",
    odd: null,
    offeredLine,
    stage: "closing",
    apiMarket: apiMarketFor(row),
    reason: `A linha atual da Bet365 (${offeredLine}) difere da linha modelada (${row.line_canonical ?? "—"}); preço não foi injetado.`,
  };
}

function predictionAtFromRun(run: { notes?: unknown; created_at?: string | null } | null | undefined) {
  const notes = typeof run?.notes === "object" && run.notes !== null
    ? run.notes as { prediction_at?: unknown }
    : null;
  const stored = notes?.prediction_at;
  if (typeof stored === "string" && Number.isFinite(Date.parse(stored))) return stored;
  return run?.created_at ?? new Date().toISOString();
}

export async function collectAutomaticBet365OddsForRun(
  db: AdminDb,
  runId: string,
): Promise<AutomaticOddsCollection> {
  const [{ data: predictions }, { data: matches }, { data: run }] = await Promise.all([
    db
      .from("model_predictions")
      .select("prediction_id,match_id,market,participant,side,line_canonical,model_probability")
      .eq("run_id", runId)
      .eq("model_status", EXPERIMENTAL_STATUS),
    db.from("matches").select("id,raw_partida,home_team,away_team").eq("run_id", runId),
    db.from("analysis_runs").select("target_date,notes,created_at").eq("id", runId).single(),
  ]);

  const quoteAnchors = filterQuoteAnchorPredictions((predictions ?? []) as PredictionRow[]);
  const eligible = quoteAnchors.filter((row) => passesExperimentalModelGate(Number(row.model_probability)));
  const matchIds = [...new Set(eligible.map((row) => row.match_id))];
  if (matchIds.length === 0) {
    return {
      quotes: [], matched: 0, lineMismatch: 0, unsupported: 0, noPrice: 0,
      sourceUnavailable: 0, fixturesRequested: 0, dayPagesRequested: 0,
      manualBatches: [], manualFieldCount: 0,
      automaticallyPricedPredictionIds: [], priorCapture: null,
      message: "Nenhuma opção passou pela regra de confiança >=70% para buscar preço.",
    };
  }

  const { data: externalIds } = await db
    .from("match_external_ids")
    .select("match_id,external_id")
    .in("match_id", matchIds)
    .eq("source", "five_dollar_fixture");

  const fixtureByMatch = new Map(((externalIds ?? []) as ExternalIdRow[]).map((row) => [row.match_id, Number(row.external_id)]));
  const matchById = new Map(((matches ?? []) as MatchRow[]).map((row) => [row.id, row]));
  const predictionsByMatch = new Map<string, PredictionRow[]>();
  for (const row of eligible) {
    const list = predictionsByMatch.get(row.match_id) ?? [];
    list.push(row);
    predictionsByMatch.set(row.match_id, list);
  }

  const targetDate = run?.target_date ?? null;
  const day = targetDate ? await fetchBet365DayOdds(targetDate) : { oddsByFixture: new Map<number, unknown>(), fetches: [] };
  for (const fetched of day.fetches) {
    await db.from("source_fetches").insert({
      run_id: runId, match_id: null, source: "five_dollar_bet365_day_odds",
      status: fetched.status === "OK" ? "OK" : fetched.status, http_status: fetched.httpStatus,
      error_message: fetched.errorMessage, fetched_at: fetched.fetchedAt,
    });
  }
  const dayFetchedAt = day.fetches.find((item) => item.status === "OK")?.fetchedAt ?? new Date().toISOString();

  const quotes: QuoteWithMatch[] = [];
  const snapshotRows: Record<string, unknown>[] = [];
  let fixturesRequested = 0;

  for (const matchId of matchIds) {
    const fixtureId = fixtureByMatch.get(matchId);
    const rows = predictionsByMatch.get(matchId) ?? [];
    const matchLabel = label(matchById.get(matchId));

    if (!fixtureId || !Number.isFinite(fixtureId)) {
      for (const row of rows) {
        const parsed: AutoOddsMatch = {
          predictionId: row.prediction_id,
          status: "SOURCE_UNAVAILABLE",
          odd: null,
          offeredLine: null,
          stage: null,
          apiMarket: null,
          reason: "Fixture ID da 5Dollar indisponível para esta partida.",
        };
        quotes.push({ ...parsed, matchId, matchLabel });
        snapshotRows.push({
          run_id: runId, match_id: matchId, prediction_id: row.prediction_id, fixture_id: null,
          bookmaker: "bet365", market: row.market, side: row.side,
          model_line: row.line_canonical === null ? null : Number(row.line_canonical), offered_line: null,
          odd: null, stage: null, api_market: null, status: parsed.status,
          reason: parsed.reason, fetched_at: dayFetchedAt,
        });
      }
      continue;
    }

    const embeddedOdds = day.oddsByFixture.get(fixtureId);
    const resolvedBeforeFull = new Map<string, AutoOddsMatch>();
    const needsFull = new Set<string>();

    for (const row of rows) {
      if (!DIRECT_MARKETS.has(row.market)) {
        resolvedBeforeFull.set(row.prediction_id, unsupported(row));
        continue;
      }
      const candidate = candidateFromRow(row);
      if (row.market === "1x2" && embeddedOdds) {
        resolvedBeforeFull.set(row.prediction_id, matchBet365List1x2(candidate, embeddedOdds));
        continue;
      }
      if ((row.market === "goals_match_total" || row.market === "corners_match_total" || row.market === "cards_match_total") && embeddedOdds) {
        const offeredLine = bet365ListOfferedLine(embeddedOdds, row.market);
        const modelLine = candidate.lineCanonical;
        if (offeredLine !== null && modelLine !== null && Math.abs(offeredLine - modelLine) > 1e-9) {
          resolvedBeforeFull.set(row.prediction_id, lineMismatch(row, offeredLine));
          continue;
        }
      }
      needsFull.add(row.prediction_id);
    }

    let fullFetch: Awaited<ReturnType<typeof fetchBet365FixtureOdds>> | null = null;
    if (needsFull.size > 0) {
      fixturesRequested += 1;
      fullFetch = await fetchBet365FixtureOdds(fixtureId);
      await db.from("source_fetches").insert({
        run_id: runId, match_id: matchId, source: "five_dollar_bet365_odds",
        status: fullFetch.status === "OK" ? "OK" : fullFetch.status, http_status: fullFetch.httpStatus,
        error_message: fullFetch.errorMessage, fetched_at: fullFetch.fetchedAt,
      });
    }

    for (const row of rows) {
      const candidate = candidateFromRow(row);
      let parsed = resolvedBeforeFull.get(row.prediction_id);
      let fetchedAt = dayFetchedAt;
      if (!parsed && needsFull.has(row.prediction_id)) {
        fetchedAt = fullFetch?.fetchedAt ?? dayFetchedAt;
        parsed = fullFetch?.status === "OK" && fullFetch.payload !== null
          ? matchBet365Price(candidate, fullFetch.payload)
          : {
              predictionId: row.prediction_id,
              status: "SOURCE_UNAVAILABLE" as const,
              odd: null,
              offeredLine: null,
              stage: null,
              apiMarket: null,
              reason: fullFetch?.errorMessage ?? `Falha ao consultar odds: ${fullFetch?.status ?? "sem resposta"}.`,
            };
      }
      parsed ??= unsupported(row);
      quotes.push({ ...parsed, matchId, matchLabel });
      snapshotRows.push({
        run_id: runId, match_id: matchId, prediction_id: row.prediction_id, fixture_id: fixtureId,
        bookmaker: "bet365", market: row.market, side: row.side,
        model_line: row.line_canonical === null ? null : Number(row.line_canonical), offered_line: parsed.offeredLine,
        odd: parsed.odd, stage: parsed.stage, api_market: parsed.apiMarket, status: parsed.status,
        reason: parsed.reason, fetched_at: fetchedAt,
      });
    }
  }

  if (snapshotRows.length > 0) {
    for (let i = 0; i < snapshotRows.length; i += 200) {
      const { error } = await db
        .from("experimental_odds_snapshots")
        .upsert(snapshotRows.slice(i, i + 200) as never[], { onConflict: "run_id,prediction_id" });
      if (error) throw new Error(`Falha ao auditar odds automáticas: ${error.message}`);
    }
  }

  const count = (status: AutoOddsMatch["status"]) => quotes.filter((quote) => quote.status === status).length;
  const automaticallyPricedPredictionIds = quotes
    .filter((quote) => quote.status === "MATCHED" && quote.odd !== null && quote.odd > 1)
    .map((quote) => quote.predictionId);
  const manualBatches = buildManualQuoteBatches(
    eligible.map((row) => ({
      predictionId: row.prediction_id,
      matchId: row.match_id,
      family: familyForMarket(row.market),
      market: row.market,
      participant: row.participant,
      side: row.side ?? "",
      probabilityExperimental: Number(row.model_probability ?? 0),
      sampleSize: 0,
      trainingMatches: 0,
    })),
    automaticallyPricedPredictionIds,
  );

  let priorCapture: Awaited<ReturnType<typeof captureFiveDollarLeaguePriorsForRun>> | null = null;
  try {
    priorCapture = await captureFiveDollarLeaguePriorsForRun(
      db as unknown as { from: (table: string) => unknown },
      runId,
      predictionAtFromRun(run),
      2,
    );
  } catch (error) {
    console.warn("[5Dollar priors] Captura de pesquisa indisponível", error);
    priorCapture = null;
  }

  return {
    quotes,
    matched: count("MATCHED"),
    lineMismatch: count("LINE_MISMATCH"),
    unsupported: count("UNSUPPORTED"),
    noPrice: count("NO_PRICE"),
    sourceUnavailable: count("SOURCE_UNAVAILABLE"),
    fixturesRequested,
    dayPagesRequested: day.fetches.length,
    manualBatches,
    manualFieldCount: manualBatches.flat().length,
    automaticallyPricedPredictionIds,
    priorCapture,
    message: "Somente opções com chance do modelo >=70% seguem para cotação; depois disso, a odd real precisa ser >=1,70, com EV >=8% e edge >=5 p.p.",
  };
}
