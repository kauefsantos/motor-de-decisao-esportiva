import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { backendOk, BackendError } from "./backend-contract";
import { familyForMarket } from "./engine/experimental-goal-markets";
import { filterQuoteAnchorPredictions, formatBookmakerLine } from "./engine/market-policy";
import { selectExperimentalPortfolio } from "./engine/portfolio-selection";
import { evaluateValue, type ValueResult } from "./engine/value";
import { EXPERIMENTAL_MARKETS_STATUS } from "./experimental-markets-run.functions";

const inputSchema = z.object({
  runId: z.string().uuid(),
  entries: z.array(z.object({
    predictionId: z.string().min(1).max(180),
    odd: z.number().finite().gt(1).lt(1000),
    lineAtEntry: z.number().finite().nullable(),
  })).min(1).max(1000),
});
const runSchema = z.object({ runId: z.string().uuid() });
const queueSchema = z.object({ queueId: z.string().uuid() });

type Prediction = {
  prediction_id: string;
  match_id: string | null;
  market: string;
  participant: string | null;
  side: string | null;
  line_raw: string | null;
  line_canonical: number | string | null;
  model_probability: number | string | null;
  model_status: string;
  data_status: string;
  model_version: string | null;
};

type Ranked = ValueResult & {
  matchId: string | null;
  matchLabel: string;
  competition: string;
  market: string;
  marketLabel: string;
  participant: string | null;
  side: string | null;
  lineCanonical: number | null;
  modelProbability: number;
  modelVersion: string;
  family: string;
};

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function labelFor(market: string, participant: string | null, side: string | null, line: string | null) {
  const n = line === null ? null : Number(line);
  const formatted = n !== null && Number.isFinite(n) ? formatBookmakerLine(n) : "";
  if (market === "corners_match_total") return `Escanteios da partida ${side === "UNDER" ? "Menos de" : "Mais de"} ${formatted}`.trim();
  if (market === "corners_team_total") return `Escanteios ${participant ?? "time"} ${side === "UNDER" ? "Menos de" : "Mais de"} ${formatted}`.trim();
  if (market === "cards_match_total") return `Cartões da partida ${side === "UNDER" ? "Menos de" : "Mais de"} ${formatted}`.trim();
  if (market === "cards_team_total") return `Cartões ${participant ?? "time"} ${side === "UNDER" ? "Menos de" : "Mais de"} ${formatted}`.trim();
  if (market === "goals_match_total") return `Gols da partida ${side === "UNDER" ? "Menos de" : "Mais de"} ${formatted}`.trim();
  if (market === "1x2") return side === "HOME" ? "Vitória mandante" : side === "AWAY" ? "Vitória visitante" : "Empate";
  if (market === "double_chance") return side === "1X" ? "Dupla chance: 1X" : side === "X2" ? "Dupla chance: X2" : "Dupla chance: 12";
  if (market === "btts") return side === "YES" ? "Ambas marcam: Sim" : "Ambas marcam: Não";
  return market;
}

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function owner(db: any, runId: string, userId: string) {
  const { data, error } = await db.from("analysis_runs").select("id,target_date").eq("id", runId).eq("owner_id", userId).single();
  if (error || !data) throw new BackendError("NOT_FOUND", "Análise não encontrada.", 404);
  return data;
}

export const buildDecisionOpportunityQueue = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!context.userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const rawDb = await db();
    await owner(rawDb, data.runId, context.userId);

    const [{ data: predictions, error: predictionError }, { data: matches, error: matchError }] = await Promise.all([
      rawDb.from("model_predictions")
        .select("prediction_id,match_id,market,participant,side,line_raw,line_canonical,model_probability,model_status,data_status,model_version")
        .eq("run_id", data.runId)
        .eq("model_status", EXPERIMENTAL_MARKETS_STATUS),
      rawDb.from("matches").select("id,raw_partida,home_team,away_team,competition").eq("run_id", data.runId),
    ]);
    if (predictionError || matchError) throw new BackendError("INTERNAL_ERROR", "Não foi possível carregar os modelos da rodada.", 500);

    const quotePredictions = filterQuoteAnchorPredictions((predictions ?? []) as Prediction[]);
    const byId = new Map(quotePredictions.map((row) => [row.prediction_id, row]));
    const matchById = new Map((matches ?? []).map((match: any) => [match.id, match]));
    const evaluated: Ranked[] = [];

    for (const entry of data.entries) {
      const prediction = byId.get(entry.predictionId);
      if (!prediction) continue;
      const probability = finite(prediction.model_probability);
      const result = evaluateValue({
        candidateId: prediction.prediction_id,
        predictionId: prediction.prediction_id,
        contractType: "BINARY",
        bookmaker: "bet365_br",
        odd: entry.odd,
        lineAtEntry: entry.lineAtEntry,
        lineCanonical: prediction.line_canonical === null ? null : Number(prediction.line_canonical),
        pCons: probability,
        outcomeDistribution: null,
        published: true,
        modelStatus: EXPERIMENTAL_MARKETS_STATUS,
        dataStatus: prediction.data_status,
      });
      const match = prediction.match_id ? matchById.get(prediction.match_id) : null;
      evaluated.push({
        ...result,
        matchId: prediction.match_id,
        matchLabel: match ? (match.home_team && match.away_team ? `${match.home_team} x ${match.away_team}` : match.raw_partida) : "—",
        competition: match?.competition ?? "",
        market: prediction.market,
        marketLabel: labelFor(prediction.market, prediction.participant, prediction.side, prediction.line_raw),
        participant: prediction.participant,
        side: prediction.side,
        lineCanonical: prediction.line_canonical === null ? null : Number(prediction.line_canonical),
        modelProbability: probability,
        modelVersion: prediction.model_version ?? "unknown",
        family: familyForMarket(prediction.market),
      });
    }

    // Keep the existing portfolio correlation protection, but remove the old 2/3
    // auto-selection cap. The result becomes the full ranked pool from which the
    // user may choose up to three.
    const portfolio = selectExperimentalPortfolio(evaluated, Math.max(1, evaluated.length));
    const qualified = portfolio.selected as Ranked[];
    const queueRows = qualified.map((row, index) => ({
      match_id: row.matchId,
      prediction_id: row.predictionId,
      rank_global: index + 1,
      match_label: row.matchLabel,
      competition: row.competition || null,
      market_family: row.family,
      market: row.market,
      market_label: row.marketLabel,
      participant: row.participant,
      side: row.side,
      line_canonical: row.lineCanonical,
      model_version: row.modelVersion,
      model_status: EXPERIMENTAL_MARKETS_STATUS,
      model_probability: row.modelProbability,
      fair_odd: row.fairOdd,
      entry_odd: row.odd,
      min_odd_target: row.minOddTarget,
      edge: row.edgeCons,
      expected_value: row.evCons,
    }));

    const { data: count, error: replaceError } = await rawDb.rpc("replace_decision_queue_atomic", {
      p_run_id: data.runId,
      p_owner_id: context.userId,
      p_rows: queueRows,
    });
    if (replaceError) throw new BackendError("CONFLICT", "A fila de opções já possui escolhas e não pode ser reconstruída.", 409);

    const { data: batch, error: batchError } = await rawDb.rpc("next_decision_batch_atomic", {
      p_run_id: data.runId,
      p_owner_id: context.userId,
      p_limit: 10,
    });
    if (batchError) throw new BackendError("INTERNAL_ERROR", "Não foi possível abrir o primeiro lote de opções.", 500);

    return backendOk({
      runId: data.runId,
      totalQualified: Number(count ?? queueRows.length),
      batch: batch ?? [],
      batchSize: (batch ?? []).length,
      exhausted: queueRows.length <= (batch ?? []).length,
      dailySelectionLimit: 3,
      correlatedAlternatesExcluded: portfolio.correlatedAlternates.length,
      message: queueRows.length === 0
        ? "Nenhuma aposta atendeu a todos os requisitos da regra de negócio."
        : queueRows.length < 10
          ? `Foram encontradas ${queueRows.length} opção(ões) válidas; nenhuma opção artificial foi adicionada.`
          : "As 10 melhores opções qualificadas estão disponíveis para escolha.",
    });
  });

export const getNextDecisionBatch = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => runSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!context.userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const rawDb = await db();
    await owner(rawDb, data.runId, context.userId);
    const { data: batch, error } = await rawDb.rpc("next_decision_batch_atomic", {
      p_run_id: data.runId,
      p_owner_id: context.userId,
      p_limit: 10,
    });
    if (error) throw new BackendError("INTERNAL_ERROR", "Não foi possível carregar o próximo lote.", 500);
    const { count: available } = await rawDb.from("decision_opportunity_queue").select("id", { count: "exact", head: true }).eq("run_id", data.runId).eq("queue_state", "AVAILABLE");
    const { count: accepted } = await rawDb.from("decision_opportunity_queue").select("id", { count: "exact", head: true }).eq("run_id", data.runId).eq("queue_state", "ACCEPTED");
    return backendOk({
      batch: batch ?? [],
      exhausted: (batch ?? []).length === 0 && Number(available ?? 0) === 0,
      acceptedCount: Number(accepted ?? 0),
      dailySelectionLimit: 3,
    });
  });

export const declineDecisionOpportunity = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => queueSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!context.userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const rawDb = await db();
    const { data: rows, error } = await rawDb.rpc("decline_decision_opportunity_atomic", {
      p_queue_id: data.queueId,
      p_owner_id: context.userId,
    });
    if (error) throw new BackendError("CONFLICT", "Essa opção não está mais disponível para recusa.", 409);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return backendOk({
      declined: Boolean(row?.declined),
      exhausted: Boolean(row?.exhausted),
      acceptedCount: Number(row?.accepted_count ?? 0),
      canProceedToStake: Boolean(row?.exhausted) && Number(row?.accepted_count ?? 0) > 0,
      message: row?.exhausted ? "Não há mais opções qualificadas. Você pode voltar ao histórico ou seguir com as escolhas já feitas." : null,
    });
  });

export const acceptDecisionOpportunity = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => queueSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!context.userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const rawDb = await db();
    const { data: rows, error } = await rawDb.rpc("accept_decision_opportunity_atomic", {
      p_queue_id: data.queueId,
      p_owner_id: context.userId,
    });
    if (error) throw new BackendError("CONFLICT", "A opção não pôde ser selecionada ou o limite diário de três escolhas foi atingido.", 409);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return backendOk({
      accepted: Boolean(row?.accepted),
      acceptedCount: Number(row?.accepted_count ?? 0),
      readyForStake: Boolean(row?.ready_for_stake),
      dailySelectionLimit: 3,
    });
  });

export const getDecisionQueueHistory = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => runSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!context.userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const rawDb = await db();
    await owner(rawDb, data.runId, context.userId);
    const { data: rows, error } = await rawDb.from("decision_opportunity_queue").select("*").eq("run_id", data.runId).order("rank_global");
    if (error) throw new BackendError("INTERNAL_ERROR", "Não foi possível recuperar o histórico da fila.", 500);
    const history = rows ?? [];
    const acceptedCount = history.filter((row: any) => row.queue_state === "ACCEPTED").length;
    const exhausted = !history.some((row: any) => row.queue_state === "AVAILABLE" || row.queue_state === "SHOWN");
    return backendOk({ rows: history, acceptedCount, exhausted, canProceedToStake: acceptedCount >= 3 || (acceptedCount > 0 && exhausted), dailySelectionLimit: 3 });
  });
