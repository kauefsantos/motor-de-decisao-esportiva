import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { PIPELINE_STEPS } from "./pipeline.steps";
import { evaluateValue, finalSelection, type ValueInput } from "./engine/value";
import type { AsianOutcomeProbabilities } from "./engine/types";

const rowSchema = z.object({
  partida: z.string().trim().min(1).max(160),
  horario: z.string().trim().min(1).max(32),
  campeonato: z.string().trim().min(1).max(120),
});

const createRunSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  headers: z.array(z.string().max(80)).max(30),
  invalidCount: z.number().int().min(0),
  leagues: z.array(z.string().max(120)).max(200),
  rows: z.array(rowSchema).min(1).max(300),
});

const oddsSchema = z.object({
  runId: z.string().uuid(),
  entries: z
    .array(
      z.object({
        candidateId: z.string().uuid(),
        odd: z.number().finite().gt(1).lt(1000),
        lineAtEntry: z.number().finite().nullable(),
      }),
    )
    .min(1)
    .max(500),
});

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const createRun = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => createRunSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = await db();
    const predictionAt = new Date().toISOString();
    const { data: runId, error } = await supabase.rpc("app_create_run_atomic", {
      p_target_date: data.targetDate,
      p_filename: data.filename,
      p_invalid_count: data.invalidCount,
      p_leagues: data.leagues,
      p_headers: data.headers,
      p_rows: data.rows,
      p_prediction_at: predictionAt,
    });
    if (error || typeof runId !== "string") {
      throw new Error(error?.message ?? "Falha ao criar a análise de forma atômica.");
    }
    return { runId, steps: PIPELINE_STEPS.map((s) => ({ ...s })) };
  });

export const analyzeOdds = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => oddsSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = await db();
    const ids = [...new Set(data.entries.map((entry) => entry.candidateId))];

    const [{ data: candidates, error: candidateError }, { data: predictions, error: predictionError }] =
      await Promise.all([
        supabase
          .from("market_candidates")
          .select(
            "id, prediction_id, market, market_family, market_label, line_canonical, p_cons, published, model_status, data_status, match_id, confidence_score, data_quality_score, reason_short",
          )
          .eq("run_id", data.runId)
          .in("id", ids),
        supabase
          .from("model_predictions")
          .select("prediction_id, outcome_distribution")
          .eq("run_id", data.runId),
      ]);

    if (candidateError) throw new Error(`Falha ao carregar mercados: ${candidateError.message}`);
    if (predictionError) throw new Error(`Falha ao carregar distribuições: ${predictionError.message}`);

    type CandidateRow = NonNullable<typeof candidates>[number];
    const byId = new Map((candidates ?? []).map((candidate) => [candidate.id, candidate]));
    const distByPrediction = new Map(
      (predictions ?? []).map((prediction) => [
        prediction.prediction_id,
        (prediction.outcome_distribution ?? null) as unknown as AsianOutcomeProbabilities | null,
      ]),
    );

    const evaluations: Array<{ result: ReturnType<typeof evaluateValue>; candidate: CandidateRow }> = [];
    const userOddsRows: Array<Record<string, unknown>> = [];

    for (const entry of data.entries) {
      const candidate = byId.get(entry.candidateId);
      if (!candidate) continue;

      userOddsRows.push({
        candidate_id: candidate.id,
        bookmaker: "bet365_br",
        odd: entry.odd,
        line_at_entry: entry.lineAtEntry,
      });

      const input: ValueInput = {
        candidateId: candidate.id,
        predictionId: candidate.prediction_id,
        contractType:
          candidate.market_family === "1X2" || candidate.market_family === "BTTS"
            ? "BINARY"
            : "ASIAN",
        bookmaker: "bet365_br",
        odd: entry.odd,
        lineAtEntry: entry.lineAtEntry,
        lineCanonical:
          candidate.line_canonical === null ? null : Number(candidate.line_canonical),
        pCons: candidate.p_cons === null ? null : Number(candidate.p_cons),
        outcomeDistribution: distByPrediction.get(candidate.prediction_id) ?? null,
        published: candidate.published,
        modelStatus: candidate.model_status,
        dataStatus: candidate.data_status,
      };
      evaluations.push({ result: evaluateValue(input), candidate });
    }

    if (evaluations.length === 0) {
      throw new Error("Nenhuma odd corresponde a um mercado desta análise.");
    }

    const selected = finalSelection(evaluations.map((entry) => entry.result));
    const selections = selected.map((selection, index) => {
      const match = evaluations.find(
        (entry) => entry.result.candidateId === selection.candidateId,
      );
      const conservativeProbability =
        selection.wEff ??
        (match?.candidate.p_cons === null || match?.candidate.p_cons === undefined
          ? 0
          : Number(match.candidate.p_cons));
      const explanation = `Probabilidade conservadora ${(conservativeProbability * 100).toFixed(1)}% contra ${(100 / selection.odd).toFixed(1)}% implícitos na odd; EV conservador ${((selection.evCons ?? 0) * 100).toFixed(2)}%.`;
      return {
        ...selection,
        rank: index + 1,
        explanation,
        matchId: match?.candidate.match_id ?? null,
        marketLabel: match?.candidate.market_label ?? "",
        confidenceScore: match?.candidate.confidence_score ?? null,
        dataQualityScore: match?.candidate.data_quality_score ?? null,
      };
    });

    const evaluationRows = evaluations.map(({ result }) => ({
      candidate_id: result.candidateId,
      odd: result.odd,
      implied_probability: result.impliedProbability,
      fair_odd: result.fairOdd,
      min_odd_target: result.minOddTarget,
      edge_cons: result.edgeCons,
      ev_cons: result.evCons,
      w_eff: result.wEff,
      l_eff: result.lEff,
      probability_status: result.probabilityStatus,
      value_status: result.valueStatus,
      execution_status: result.executionStatus,
      rejection_reason: result.rejectionReason,
    }));

    const selectionRows = selections.map((selection) => ({
      candidate_id: selection.candidateId,
      rank: selection.rank,
      explanation: selection.explanation,
    }));

    const { error: persistError } = await supabase.rpc("app_replace_value_results_atomic", {
      p_run_id: data.runId,
      p_user_odds: userOddsRows,
      p_evaluations: evaluationRows,
      p_selections: selectionRows,
      p_completed_at: new Date().toISOString(),
    });
    if (persistError) {
      throw new Error(`Falha ao persistir a análise de odds: ${persistError.message}`);
    }

    const selectedIds = new Set(selections.map((selection) => selection.candidateId));
    const rejected = evaluations
      .filter((entry) => !selectedIds.has(entry.result.candidateId))
      .map((entry) => ({
        ...entry.result,
        marketLabel: entry.candidate.market_label,
        matchId: entry.candidate.match_id,
      }));

    return { selections, rejected };
  });
