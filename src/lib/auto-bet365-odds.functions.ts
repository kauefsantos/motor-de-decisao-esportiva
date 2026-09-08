import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  fetchBet365FixtureOdds,
  matchBet365Price,
  type AutoOddsCandidate,
  type AutoOddsMatch,
} from "./bet365-odds.server";
import { BASE_GATE } from "./engine/opportunity";

const inputSchema = z.object({ runId: z.string().uuid() });
const EXPERIMENTAL_STATUS = "EXPERIMENTAL_CURRENT_SEASON";

type PredictionRow = {
  prediction_id: string;
  match_id: string;
  market: string;
  side: string | null;
  line_canonical: number | string | null;
  model_probability: number | string | null;
};

type ExternalIdRow = {
  match_id: string;
  external_id: string;
};

type MatchRow = {
  id: string;
  raw_partida: string;
  home_team: string | null;
  away_team: string | null;
};

function label(match: MatchRow | undefined) {
  if (!match) return "—";
  return match.home_team && match.away_team
    ? `${match.home_team} x ${match.away_team}`
    : match.raw_partida;
}

export const collectAutomaticBet365Odds = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = supabaseAdmin;

    const [{ data: predictions }, { data: matches }] = await Promise.all([
      supabase
        .from("model_predictions")
        .select("prediction_id,match_id,market,side,line_canonical,model_probability")
        .eq("run_id", data.runId)
        .eq("model_status", EXPERIMENTAL_STATUS),
      supabase
        .from("matches")
        .select("id,raw_partida,home_team,away_team")
        .eq("run_id", data.runId),
    ]);

    const eligible = ((predictions ?? []) as PredictionRow[]).filter(
      (row) => Number(row.model_probability ?? 0) >= BASE_GATE,
    );
    const matchIds = [...new Set(eligible.map((row) => row.match_id))];
    if (matchIds.length === 0) {
      return {
        quotes: [] as (AutoOddsMatch & { matchId: string; matchLabel: string })[],
        matched: 0,
        lineMismatch: 0,
        unsupported: 0,
        noPrice: 0,
        sourceUnavailable: 0,
        fixturesRequested: 0,
        message: "Nenhum mercado experimental passou pelo gate para buscar preço.",
      };
    }

    const { data: externalIds } = await supabase
      .from("match_external_ids")
      .select("match_id,external_id")
      .in("match_id", matchIds)
      .eq("source", "five_dollar_fixture");

    const fixtureByMatch = new Map(
      ((externalIds ?? []) as ExternalIdRow[]).map((row) => [row.match_id, Number(row.external_id)]),
    );
    const matchById = new Map(((matches ?? []) as MatchRow[]).map((row) => [row.id, row]));
    const predictionsByMatch = new Map<string, PredictionRow[]>();
    for (const row of eligible) {
      const list = predictionsByMatch.get(row.match_id) ?? [];
      list.push(row);
      predictionsByMatch.set(row.match_id, list);
    }

    const quotes: (AutoOddsMatch & { matchId: string; matchLabel: string })[] = [];
    const snapshotRows: Record<string, unknown>[] = [];
    let fixturesRequested = 0;

    // Uma única chamada de odds por partida. O adapter 5Dollar aplica o throttle Pro
    // global e reaproveita o cache por 15 min em reaberturas da mesma tela.
    for (const matchId of matchIds) {
      const fixtureId = fixtureByMatch.get(matchId);
      const rows = predictionsByMatch.get(matchId) ?? [];
      const matchLabel = label(matchById.get(matchId));

      if (!fixtureId || !Number.isFinite(fixtureId)) {
        for (const row of rows) {
          const quote: AutoOddsMatch & { matchId: string; matchLabel: string } = {
            predictionId: row.prediction_id,
            matchId,
            matchLabel,
            status: "SOURCE_UNAVAILABLE",
            odd: null,
            offeredLine: null,
            stage: null,
            apiMarket: null,
            reason: "Fixture ID da 5Dollar indisponível para esta partida.",
          };
          quotes.push(quote);
        }
        continue;
      }

      fixturesRequested += 1;
      const fetched = await fetchBet365FixtureOdds(fixtureId);
      await supabase.from("source_fetches").insert({
        run_id: data.runId,
        match_id: matchId,
        source: "five_dollar_bet365_odds",
        status: fetched.status === "OK" ? "OK" : fetched.status,
        http_status: fetched.httpStatus,
        error_message: fetched.errorMessage,
        fetched_at: fetched.fetchedAt,
      });

      for (const row of rows) {
        const candidate: AutoOddsCandidate = {
          predictionId: row.prediction_id,
          market: row.market,
          side: row.side,
          lineCanonical:
            row.line_canonical === null ? null : Number(row.line_canonical),
        };
        const parsed = fetched.status === "OK" && fetched.payload !== null
          ? matchBet365Price(candidate, fetched.payload)
          : {
              predictionId: row.prediction_id,
              status: "SOURCE_UNAVAILABLE" as const,
              odd: null,
              offeredLine: null,
              stage: null,
              apiMarket: null,
              reason: fetched.errorMessage ?? `Falha ao consultar odds: ${fetched.status}.`,
            };
        quotes.push({ ...parsed, matchId, matchLabel });
        snapshotRows.push({
          run_id: data.runId,
          match_id: matchId,
          prediction_id: row.prediction_id,
          fixture_id: fixtureId,
          bookmaker: "bet365",
          market: row.market,
          side: row.side,
          model_line: row.line_canonical === null ? null : Number(row.line_canonical),
          offered_line: parsed.offeredLine,
          odd: parsed.odd,
          stage: parsed.stage,
          api_market: parsed.apiMarket,
          status: parsed.status,
          reason: parsed.reason,
          fetched_at: fetched.fetchedAt,
        });
      }
    }

    if (snapshotRows.length > 0) {
      for (let i = 0; i < snapshotRows.length; i += 200) {
        const { error } = await supabase
          .from("experimental_odds_snapshots")
          .upsert(snapshotRows.slice(i, i + 200) as never[], {
            onConflict: "run_id,prediction_id",
          });
        if (error) throw new Error(`Falha ao auditar odds automáticas: ${error.message}`);
      }
    }

    const count = (status: AutoOddsMatch["status"]) =>
      quotes.filter((quote) => quote.status === status).length;

    return {
      quotes,
      matched: count("MATCHED"),
      lineMismatch: count("LINE_MISMATCH"),
      unsupported: count("UNSUPPORTED"),
      noPrice: count("NO_PRICE"),
      sourceUnavailable: count("SOURCE_UNAVAILABLE"),
      fixturesRequested,
      message: "Odds pré-jogo da Bet365 consultadas após o Motor 1, sem usar preço na geração das probabilidades.",
    };
  });
