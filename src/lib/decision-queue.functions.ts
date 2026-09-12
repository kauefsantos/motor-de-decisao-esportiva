import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { adminDb, type AdminDb } from "./admin-db";
import { backendOk, BackendError } from "./backend-contract";
import { familyForMarket } from "./engine/experimental-goal-markets";
import { filterQuoteAnchorPredictions, formatBookmakerLine } from "./engine/market-policy";
import { selectExperimentalPortfolio } from "./engine/portfolio-selection";
import { evaluateValue, type ValueResult } from "./engine/value";
import { EXPERIMENTAL_MARKETS_STATUS } from "./experimental-markets-run.functions";
import {
  acceptDecisionQueueItem,
  declineDecisionQueueItem,
  finalizeDecisionQueueSelection,
  findOwnedDecisionRun,
  nextDecisionBatch,
  replaceDecisionQueue,
} from "./repositories/decision-queue.repository.server";

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
const DECISION_QUEUE_EVALUATED_STEP = "DECISION_QUEUE_EVALUATED";

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

type DecisionMatchRow = {
  id: string;
  raw_partida: string;
  home_team: string | null;
  away_team: string | null;
  competition: string | null;
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

function labelFor(
  market: string,
  participant: string | null,
  side: string | null,
  line: string | null,
) {
  const number = line === null ? null : Number(line);
  const formatted = number !== null && Number.isFinite(number) ? formatBookmakerLine(number) : "";
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

async function owner(db: AdminDb, runId: string, userId: string) {
  const run = await findOwnedDecisionRun(db, runId, userId);
  if (!run) throw new BackendError("NOT_FOUND", "Análise não encontrada.", 404);
  return run;
}

export const buildDecisionOpportunityQueue = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!context.userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const db = await adminDb();
    await owner(db, data.runId, context.userId);

    const [{ data: predictions, error: predictionError }, { data: matches, error: matchError }] = await Promise.all([
      db.from("model_predictions")
        .select("prediction_id,match_id,market,participant,side,line_raw,line_canonical,model_probability,model_status,data_status,model_version")
        .eq("run_id", data.runId)
        .eq("model_status", EXPERIMENTAL_MARKETS_STATUS),
      db.from("matches")
        .select("id,raw_partida,home_team,away_team,competition")
        .eq("run_id", data.runId),
    ]);
    if (predictionError || matchError) {
      throw new BackendError("INTERNAL_ERROR", "Não foi possível carregar os modelos da rodada.", 500);
    }

    const quotePredictions = filterQuoteAnchorPredictions((predictions ?? []) as Prediction[]);
    const byId = new Map(quotePredictions.map((row) => [row.prediction_id, row]));
    const matchById = new Map(
      ((matches ?? []) as DecisionMatchRow[]).map((match) => [match.id, match]),
    );
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
        matchLabel: match
          ? match.home_team && match.away_team
            ? `${match.home_team} x ${match.away_team}`
            : match.raw_partida
          : "—",
        competition: match?.competition ?? "",
        market: prediction.market,
        marketLabel: labelFor(
          prediction.market,
          prediction.participant,
          prediction.side,
          prediction.line_raw,
        ),
        participant: prediction.participant,
        side: prediction.side,
        lineCanonical: prediction.line_canonical === null ? null : Number(prediction.line_canonical),
        modelProbability: probability,
        modelVersion: prediction.model_version ?? "unknown",
        family: familyForMarket(prediction.market),
      });
    }

    const portfolio = selectExperimentalPortfolio(evaluated);
    const qualified = ([...portfolio.selected, ...portfolio.correlatedAlternates] as Ranked[])
      .sort(
        (a, b) => (b.evCons ?? -Infinity) - (a.evCons ?? -Infinity) ||
          (b.edgeCons ?? -Infinity) - (a.edgeCons ?? -Infinity),
      );
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

    const replaceResult = await replaceDecisionQueue(db, {
      runId: data.runId,
      ownerId: context.userId,
      rows: queueRows,
    });
    if (replaceResult.error) {
      throw new BackendError(
        "CONFLICT",
        "A fila de opções já possui escolhas e não pode ser reconstruída.",
        409,
      );
    }

    const evaluatedCount = Number(replaceResult.data ?? queueRows.length);
    const { error: markerError } = await db.from("pipeline_logs").insert({
      run_id: data.runId,
      step: DECISION_QUEUE_EVALUATED_STEP,
      level: "INFO",
      message: evaluatedCount === 0
        ? "Fila de decisão avaliada sem opções qualificadas."
        : `Fila de decisão avaliada com ${evaluatedCount} opção(ões) qualificadas.`,
      payload: { totalQualified: evaluatedCount },
    });
    if (markerError) {
      throw new BackendError(
        "INTERNAL_ERROR",
        "A avaliação foi concluída, mas seu estado não pôde ser persistido.",
        500,
      );
    }

    const batchResult = await nextDecisionBatch(db, {
      runId: data.runId,
      ownerId: context.userId,
      limit: 10,
    });
    if (batchResult.error) {
      throw new BackendError("INTERNAL_ERROR", "Não foi possível abrir o primeiro lote de opções.", 500);
    }
    const batch = batchResult.data ?? [];

    return backendOk({
      runId: data.runId,
      totalQualified: evaluatedCount,
      batch,
      batchSize: batch.length,
      exhausted: queueRows.length <= batch.length,
      dailySelectionLimit: 3,
      correlatedAlternatesDeferred: portfolio.correlatedAlternates.length,
      message: queueRows.length === 0
        ? "Nenhuma aposta atendeu a todos os requisitos da regra de negócio."
        : queueRows.length < 10
          ? `Foram encontradas ${queueRows.length} opção(ões) válidas; nenhuma opção artificial foi adicionada.`
          : "As melhores opções qualificadas estão disponíveis em lotes de até 10.",
    });
  });

export const getNextDecisionBatch = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => runSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!context.userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const db = await adminDb();
    const run = await owner(db, data.runId, context.userId);
    if (run.selection_finalized_at) {
      const { count: accepted } = await db
        .from("decision_opportunity_queue")
        .select("id", { count: "exact", head: true })
        .eq("run_id", data.runId)
        .eq("queue_state", "ACCEPTED");
      return backendOk({
        batch: [],
        exhausted: false,
        acceptedCount: Number(accepted ?? 0),
        selectionFinalized: true,
        canProceedToStake: Number(accepted ?? 0) > 0,
        dailySelectionLimit: 3,
      });
    }
    const batchResult = await nextDecisionBatch(db, {
      runId: data.runId,
      ownerId: context.userId,
      limit: 10,
    });
    if (batchResult.error) {
      throw new BackendError("INTERNAL_ERROR", "Não foi possível carregar o próximo lote.", 500);
    }
    const batch = batchResult.data ?? [];
    const { count: available } = await db
      .from("decision_opportunity_queue")
      .select("id", { count: "exact", head: true })
      .eq("run_id", data.runId)
      .eq("queue_state", "AVAILABLE");
    const { count: accepted } = await db
      .from("decision_opportunity_queue")
      .select("id", { count: "exact", head: true })
      .eq("run_id", data.runId)
      .eq("queue_state", "ACCEPTED");
    return backendOk({
      batch,
      exhausted: batch.length === 0 && Number(available ?? 0) === 0,
      acceptedCount: Number(accepted ?? 0),
      selectionFinalized: false,
      canProceedToStake: false,
      dailySelectionLimit: 3,
    });
  });

export const declineDecisionOpportunity = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => queueSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!context.userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const db = await adminDb();
    const result = await declineDecisionQueueItem(db, {
      queueId: data.queueId,
      ownerId: context.userId,
    });
    if (result.error) {
      throw new BackendError("CONFLICT", "Essa opção não está mais disponível para recusa.", 409);
    }
    const rows = result.data;
    const row = Array.isArray(rows) ? rows[0] : rows;
    return backendOk({
      declined: Boolean(row?.declined),
      exhausted: Boolean(row?.exhausted),
      acceptedCount: Number(row?.accepted_count ?? 0),
      canProceedToStake: Boolean(row?.exhausted) && Number(row?.accepted_count ?? 0) > 0,
      message: row?.exhausted
        ? "Não há mais opções qualificadas. Você pode voltar ao histórico ou seguir com as escolhas já feitas."
        : null,
    });
  });

export const acceptDecisionOpportunity = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => queueSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!context.userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const db = await adminDb();
    const result = await acceptDecisionQueueItem(db, {
      queueId: data.queueId,
      ownerId: context.userId,
    });
    if (result.error) {
      throw new BackendError(
        "CONFLICT",
        "A opção não pôde ser selecionada, há outra escolha do mesmo jogo ou o limite diário de três escolhas foi atingido.",
        409,
      );
    }
    const rows = result.data;
    const row = Array.isArray(rows) ? rows[0] : rows;
    return backendOk({
      accepted: Boolean(row?.accepted),
      acceptedCount: Number(row?.accepted_count ?? 0),
      readyForStake: Boolean(row?.ready_for_stake),
      dailySelectionLimit: 3,
    });
  });

export const finalizeDecisionSelection = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => runSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!context.userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const db = await adminDb();
    await owner(db, data.runId, context.userId);
    const result = await finalizeDecisionQueueSelection(db, {
      runId: data.runId,
      ownerId: context.userId,
    });
    if (result.error) {
      throw new BackendError(
        "CONFLICT",
        "Escolha ao menos uma e no máximo três apostas antes de continuar.",
        409,
      );
    }
    const rows = result.data;
    const row = Array.isArray(rows) ? rows[0] : rows;
    return backendOk({
      finalized: Boolean(row?.finalized),
      acceptedCount: Number(row?.accepted_count ?? 0),
      readyForStake: Boolean(row?.finalized),
      dailySelectionLimit: 3,
    });
  });

export const getDecisionQueueHistory = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => runSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!context.userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const db = await adminDb();
    const run = await owner(db, data.runId, context.userId);
    const [queueResult, evaluationResult] = await Promise.all([
      db
        .from("decision_opportunity_queue")
        .select("*")
        .eq("run_id", data.runId)
        .order("rank_global"),
      db
        .from("pipeline_logs")
        .select("id", { count: "exact", head: true })
        .eq("run_id", data.runId)
        .eq("step", DECISION_QUEUE_EVALUATED_STEP),
    ]);
    if (queueResult.error || evaluationResult.error) {
      throw new BackendError("INTERNAL_ERROR", "Não foi possível recuperar o histórico da fila.", 500);
    }
    const history = queueResult.data ?? [];
    const acceptedCount = history.filter((row) => row.queue_state === "ACCEPTED").length;
    const exhausted = !history.some(
      (row) => row.queue_state === "AVAILABLE" || row.queue_state === "SHOWN",
    );
    const selectionFinalized = Boolean(run.selection_finalized_at);
    const decisionQueueEvaluated = history.length > 0 || Number(evaluationResult.count ?? 0) > 0;
    return backendOk({
      rows: history,
      acceptedCount,
      exhausted,
      selectionFinalized,
      decisionQueueEvaluated,
      canProceedToStake: selectionFinalized || acceptedCount >= 3 || (acceptedCount > 0 && exhausted),
      dailySelectionLimit: 3,
    });
  });
