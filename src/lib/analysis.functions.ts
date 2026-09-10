import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { PIPELINE_STEPS, type PipelineStepKey } from "./pipeline.steps";

export { createRun, analyzeOdds } from "./analysis-atomic.functions";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

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
    const { executeStep } = await import("./pipeline.server");
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

/** Auditoria da ingestão: estado por fonte e detalhe de resolução/coleta por partida. */
export const getAudit = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const supabase = await db();
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
