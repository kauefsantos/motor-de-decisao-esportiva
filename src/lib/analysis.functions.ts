import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { PIPELINE_STEPS, type PipelineStepKey } from "./pipeline.steps";
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

async function authorizeRun(supabase: any, userId: string | undefined, runId: string) {
  const { assertRunOwner } = await import("./authorization.server");
  await assertRunOwner(supabase, userId, runId);
}

export const createRun = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => createRunSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Usuário não autenticado.");
    const supabase = await db();
    const { data: run, error } = await supabase
      .from("analysis_runs")
      .insert({
        owner_id: userId,
        target_date: data.targetDate,
        status: "CREATED",
        matches_total: data.rows.length,
        // prediction_at único da análise: mesmo corte temporal em todas as etapas.
        notes: { prediction_at: new Date().toISOString() },
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
  .handler(async ({ data, context }) => {
    const supabase = await db();
    await authorizeRun(supabase, context.userId, data.runId);
    const { executeStep } = await import("./pipeline.server");
    const result = await executeStep(data.runId, data.step);
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
  .handler(async ({ data, context }) => {
    const supabase = await db();
    await authorizeRun(supabase, context.userId, data.runId);
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
  .handler(async ({ data, context }) => {
    const supabase = await db();
    await authorizeRun(supabase, context.userId, data.runId);
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
      .eq("id", data.runId)
      .eq("owner_id", context.userId);

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
  .handler(async ({ data, context }) => {
    const supabase = await db();
    await authorizeRun(supabase, context.userId, data.runId);
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

/** Auditoria da ingestão: estado por fonte e detalhe de resolução/coleta por partida. */
export const getAudit = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const supabase = await db();
    await authorizeRun(supabase, context.userId, data.runId);
    const [
      { data: fetches },
      { data: matches },
      { data: externalIds },
      { data: normalized },
      { data: raws },
      { data: definitions },
    ] = await Promise.all([
      supabase
        .from("source_fetches")
        .select("source, status, http_status, error_message, fetched_at, match_id")
        .eq("run_id", data.runId),
      supabase
        .from("matches")
        .select(
          "id, raw_partida, home_team, away_team, competition, kickoff_local, resolution_status, resolution_reason, resolver_confidence",
        )
        .eq("run_id", data.runId),
      supabase.from("match_external_ids").select("match_id, source, external_id, confidence"),
      supabase
        .from("normalized_match_stats")
        .select("match_id, scope, metric, normalized_value, sample_size, source, definition_version, lineage")
        .eq("run_id", data.runId),
      supabase
        .from("raw_observations")
        .select("match_id, source, metric, raw_value, definition_version")
        .eq("run_id", data.runId),
      supabase.from("source_definitions").select("source, definition_version, notes, metric_definitions"),
    ]);

    const matchIds = new Set((matches ?? []).map((m) => m.id));
    const sources = new Map<
      string,
      { source: string; ok: number; unavailable: number; notConfigured: number; lastFetchedAt: string | null; lastError: string | null }
    >();
    for (const f of fetches ?? []) {
      const s = sources.get(f.source) ?? {
        source: f.source,
        ok: 0,
        unavailable: 0,
        notConfigured: 0,
        lastFetchedAt: null,
        lastError: null,
      };
      if (f.status === "OK") s.ok += 1;
      else if (f.status === "NOT_CONFIGURED") s.notConfigured += 1;
      else s.unavailable += 1;
      if (!s.lastFetchedAt || (f.fetched_at && f.fetched_at > s.lastFetchedAt)) {
        s.lastFetchedAt = f.fetched_at;
      }
      if (f.error_message) s.lastError = f.error_message;
      sources.set(f.source, s);
    }

    type ResearchRaw = {
      value?: number;
      valueRaw?: string;
      metricLabelRaw?: string;
      contractCompatible?: boolean;
      note?: string;
      sourceUrl?: string;
      team?: string;
      externalMatchId?: string;
      fixtureDate?: string;
      opponent?: string;
      historyStatus?: string;
      reusedFromCache?: boolean;
      mode?: string;
    };

    const researchRaws = (raws ?? []).filter((r) => r.source === "research_adapter");
    const researchMode =
      (definitions ?? []).find((d) => d.source === "research_adapter")?.notes ??
      "Desk Research / Dados Públicos";

    const perMatch = (matches ?? []).map((m) => {
      const mine = researchRaws.filter((r) => r.match_id === m.id);
      const accepted = new Map<string, number>();
      const rejected = new Map<string, { count: number; note: string | null }>();
      const fixtures = new Map<string, { date: string; team: string; opponent: string }>();
      const urls = new Set<string>();
      let historyStatus: string | null = null;
      let reused = 0;

      for (const r of mine) {
        const v = (r.raw_value ?? {}) as ResearchRaw;
        const canonical = r.metric.split(":")[1] ?? r.metric;
        if (v.sourceUrl) urls.add(v.sourceUrl);
        if (v.historyStatus) historyStatus = v.historyStatus;
        if (v.reusedFromCache) reused += 1;
        if (v.externalMatchId) {
          fixtures.set(v.externalMatchId, {
            date: v.fixtureDate ?? "—",
            team: v.team ?? "—",
            opponent: v.opponent ?? "—",
          });
        }
        if (v.contractCompatible === true) {
          accepted.set(canonical, (accepted.get(canonical) ?? 0) + 1);
        } else {
          const prev = rejected.get(canonical);
          rejected.set(canonical, { count: (prev?.count ?? 0) + 1, note: v.note ?? prev?.note ?? null });
        }
      }

      return {
        ...m,
        externalIds: (externalIds ?? []).filter((e) => e.match_id === m.id),
        normalized: (normalized ?? []).filter((n) => n.match_id === m.id),
        research:
          mine.length > 0
            ? {
                mode: researchMode,
                urls: [...urls],
                historyStatus,
                reusedFromCache: reused,
                fixtures: [...fixtures.entries()].map(([id, f]) => ({ id, ...f })),
                accepted: [...accepted.entries()].map(([metric, count]) => ({ metric, count })),
                rejected: [...rejected.entries()].map(([metric, r]) => ({
                  metric,
                  count: r.count,
                  note: r.note,
                })),
              }
            : null,
      };
    });

    const researchActive =
      researchRaws.length > 0 || (fetches ?? []).some((f) => f.source === "research_adapter");

    return {
      mode: researchActive ? "Desk Research / Dados Públicos" : "APIs configuradas",
      sources: [...sources.values()].map((s) => ({
        ...s,
        status: s.ok > 0 ? (s.unavailable > 0 ? "PARTIAL" : "OK") : s.notConfigured > 0 && s.unavailable === 0 ? "NOT_CONFIGURED" : "UNAVAILABLE",
      })),
      resolvedEvents: (externalIds ?? []).filter(
        (e) => e.source === "api_football_fixture" && matchIds.has(e.match_id),
      ).length,
      researchResolved: new Set(
        (externalIds ?? [])
          .filter((e) => e.source === "research_team_home" && matchIds.has(e.match_id))
          .map((e) => e.match_id),
      ).size,
      normalizedObservations: (normalized ?? []).length,
      rawObservations: (raws ?? []).length,
      crossChecked: (normalized ?? []).filter(
        (n) =>
          ((n.lineage as { crossCheck?: { status?: string } } | null)?.crossCheck?.status ?? "") ===
          "CROSS_SOURCE_CONFIRMED",
      ).length,
      sourceConflicts: (normalized ?? []).filter(
        (n) =>
          ((n.lineage as { crossCheck?: { status?: string } } | null)?.crossCheck?.status ?? "") ===
          "SOURCE_CONFLICT",
      ).length,
      matches: perMatch,
    };
  });
