import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { PIPELINE_STEPS, executeStep, type PipelineStepKey } from "./pipeline.server";
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

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const createRun = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => createRunSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = await db();
    const { data: run, error } = await supabase
      .from("analysis_runs")
      .insert({
        target_date: data.targetDate,
        status: "CREATED",
        matches_total: data.rows.length,
      })
      .select("id")
      .single();
    if (error || !run) throw new Error(error?.message ?? "Falha ao criar a análise");

    await supabase.from("uploaded_files").insert({
      run_id: run.id,
      filename: data.filename,
      row_count: data.rows.length,
      invalid_row_count: data.invalidCount,
      leagues: data.leagues,
      raw_headers: data.headers,
    });

    await supabase.from("matches").insert(
      data.rows.map((r) => ({
        run_id: run.id,
        raw_partida: r.partida,
        raw_horario: r.horario,
        raw_campeonato: r.campeonato,
      })),
    );

    return { runId: run.id, steps: PIPELINE_STEPS.map((s) => ({ ...s })) };
  });

export const runStep = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        runId: z.string().uuid(),
        step: z.enum(PIPELINE_STEPS.map((s) => s.key) as [PipelineStepKey, ...PipelineStepKey[]]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const result = await executeStep(data.runId, data.step);
    const supabase = await db();
    const { data: logs } = await supabase
      .from("pipeline_logs")
      .select("step, level, message, payload")
      .eq("run_id", data.runId)
      .eq("step", data.step)
      .order("created_at", { ascending: false })
      .limit(1);
    return { step: data.step, result, log: logs?.[0] ?? null };
  });

export const getRun = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const supabase = await db();
    const [{ data: run }, { data: candidates }, { data: logs }, { data: fetches }] =
      await Promise.all([
        supabase.from("analysis_runs").select("*").eq("id", data.runId).single(),
        supabase
          .from("market_candidates")
          .select(
            "id, prediction_id, market, market_family, market_label, participant, side, line_raw, line_canonical, p_cal, p_cons, fair_odd_info, confidence_score, data_quality_score, sample_reliability, uncertainty, stability, market_score, settlement_definition, model_status, data_status, published, block_reason, reason_short, match_id",
          )
          .eq("run_id", data.runId)
          .order("market_score", { ascending: false, nullsFirst: false }),
        supabase
          .from("pipeline_logs")
          .select("step, level, message, payload, created_at")
          .eq("run_id", data.runId)
          .order("created_at", { ascending: true }),
        supabase
          .from("source_fetches")
          .select("source, status")
          .eq("run_id", data.runId),
      ]);

    const { data: matches } = await supabase
      .from("matches")
      .select("id, raw_partida, home_team, away_team, competition, kickoff_local, resolution_status")
      .eq("run_id", data.runId);

    const sourceSummary: Record<string, number> = {};
    for (const f of fetches ?? []) {
      const key = `${f.source} · ${f.status}`;
      sourceSummary[key] = (sourceSummary[key] ?? 0) + 1;
    }

    return { run, candidates: candidates ?? [], matches: matches ?? [], logs: logs ?? [], sourceSummary };
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

export const analyzeOdds = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => oddsSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = await db();
    const ids = data.entries.map((e) => e.candidateId);
    const { data: candidates } = await supabase
      .from("market_candidates")
      .select(
        "id, prediction_id, market, market_family, market_label, line_canonical, p_cons, published, model_status, data_status, match_id, confidence_score, data_quality_score, reason_short",
      )
      .eq("run_id", data.runId)
      .in("id", ids);

    const { data: predictions } = await supabase
      .from("model_predictions")
      .select("prediction_id, outcome_distribution")
      .eq("run_id", data.runId);
    const distByPrediction = new Map(
      (predictions ?? []).map((p) => [
        p.prediction_id,
        (p.outcome_distribution ?? null) as unknown as AsianOutcomeProbabilities | null,
      ]),
    );

    const byId = new Map((candidates ?? []).map((c) => [c.id, c]));

    await supabase.from("user_odds").delete().eq("run_id", data.runId);
    await supabase.from("value_evaluations").delete().eq("run_id", data.runId);

    const evaluations = [];
    for (const entry of data.entries) {
      const c = byId.get(entry.candidateId);
      if (!c) continue;
      await supabase.from("user_odds").insert({
        run_id: data.runId,
        candidate_id: c.id,
        bookmaker: "bet365_br",
        odd: entry.odd,
        line_at_entry: entry.lineAtEntry,
      });

      const input: ValueInput = {
        candidateId: c.id,
        predictionId: c.prediction_id,
        contractType: c.market_family === "1X2" || c.market_family === "BTTS" ? "BINARY" : "ASIAN",
        bookmaker: "bet365_br",
        odd: entry.odd,
        lineAtEntry: entry.lineAtEntry,
        lineCanonical: c.line_canonical === null ? null : Number(c.line_canonical),
        pCons: c.p_cons === null ? null : Number(c.p_cons),
        outcomeDistribution: distByPrediction.get(c.prediction_id) ?? null,
        published: c.published,
        modelStatus: c.model_status,
        dataStatus: c.data_status,
      };
      const result = evaluateValue(input);
      evaluations.push({ result, candidate: c });
    }

    const inserted = [];
    for (const e of evaluations) {
      const { data: row } = await supabase
        .from("value_evaluations")
        .insert({
          run_id: data.runId,
          candidate_id: e.result.candidateId,
          odd: e.result.odd,
          implied_probability: e.result.impliedProbability,
          fair_odd: e.result.fairOdd,
          min_odd_target: e.result.minOddTarget,
          edge_cons: e.result.edgeCons,
          ev_cons: e.result.evCons,
          w_eff: e.result.wEff,
          l_eff: e.result.lEff,
          probability_status: e.result.probabilityStatus,
          value_status: e.result.valueStatus,
          execution_status: e.result.executionStatus,
          rejection_reason: e.result.rejectionReason,
        })
        .select("id")
        .single();
      inserted.push({ ...e, evaluationId: row?.id ?? null });
    }

    const selected = finalSelection(inserted.map((i) => i.result));
    await supabase.from("final_selections").delete().eq("run_id", data.runId);

    const selections: Array<
      (typeof selected)[number] & {
        rank: number;
        explanation: string;
        matchId: string | null;
        marketLabel: string;
        confidenceScore: number | null;
        dataQualityScore: number | null;
      }
    > = [];
    let rank = 0;
    for (const s of selected) {
      rank += 1;
      const match = inserted.find((i) => i.result.candidateId === s.candidateId);
      const explanation = `Probabilidade conservadora ${(
        (s.wEff ?? (match?.candidate.p_cons ? Number(match.candidate.p_cons) : 0)) * 100
      ).toFixed(1)}% contra ${(100 / s.odd).toFixed(1)}% implícitos na odd; EV conservador ${(
        (s.evCons ?? 0) * 100
      ).toFixed(2)}%.`;
      if (match?.evaluationId) {
        await supabase.from("final_selections").insert({
          run_id: data.runId,
          evaluation_id: match.evaluationId,
          rank,
          explanation,
        });
      }
      selections.push({
        ...s,
        rank,
        explanation,
        matchId: match?.candidate.match_id ?? null,
        marketLabel: match?.candidate.market_label ?? "",
        confidenceScore: match?.candidate.confidence_score ?? null,
        dataQualityScore: match?.candidate.data_quality_score ?? null,
      });
    }

    await supabase
      .from("analysis_runs")
      .update({
        selections_count: selections.length,
        status: "COMPLETED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.runId);

    const rejected = inserted
      .filter((i) => !selections.some((s) => s.candidateId === i.result.candidateId))
      .map((i) => ({
        ...i.result,
        marketLabel: i.candidate.market_label,
        matchId: i.candidate.match_id,
      }));

    return { selections, rejected };
  });

export const getResults = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const supabase = await db();
    const { data: evaluations } = await supabase
      .from("value_evaluations")
      .select("*")
      .eq("run_id", data.runId);
    const { data: selections } = await supabase
      .from("final_selections")
      .select("*")
      .eq("run_id", data.runId)
      .order("rank", { ascending: true });
    const ids = (evaluations ?? []).map((e) => e.candidate_id);
    const { data: candidates } = ids.length
      ? await supabase
          .from("market_candidates")
          .select(
            "id, prediction_id, market_label, match_id, confidence_score, data_quality_score, settlement_definition, reason_short",
          )
          .in("id", ids)
      : { data: [] };
    const { data: matches } = await supabase
      .from("matches")
      .select("id, raw_partida, home_team, away_team, competition, kickoff_local")
      .eq("run_id", data.runId);

    return {
      evaluations: evaluations ?? [],
      selections: selections ?? [],
      candidates: candidates ?? [],
      matches: matches ?? [],
    };
  });
