// Pipeline único: CSV -> resolução -> coleta -> limpeza -> features -> modelo -> mercados.
// Provedores suportados: 5DollarFootballAPI (padrão) e API-Football/API-Sports.

import { adminDb } from "./admin-db";
import { prepareExperimentalPredictionsForRun } from "./application/experimental-markets/prepare-run.server";
import { EXPERIMENTAL_MARKETS_STATUS } from "./application/experimental-markets/contracts";
import { MIN_MODEL_PROBABILITY, percentageLabel } from "./engine/decision-rules";
import { buildContracts } from "./engine/markets";
import { evaluateContract, type MatchContext, type ModelRegistryEntry } from "./engine/opportunity";

export type { PipelineStepKey } from "./pipeline.steps";
import type { PipelineStepKey } from "./pipeline.steps";
import { collectPipelineData } from "./pipeline/collect.server";
import { resolvePipelineMatches } from "./pipeline/resolve.server";
import { activeFootballProvider } from "./pipeline/provider.server";

type Db = Awaited<ReturnType<typeof adminDb>>;

async function log(
  db: Db,
  runId: string,
  step: string,
  message: string,
  level: "INFO" | "WARN" | "ERROR" = "INFO",
  payload: Record<string, unknown> = {},
) {
  await db.from("pipeline_logs").insert({ run_id: runId, step, level, message, payload: payload as never });
}

async function runPredictionAt(db: Db, runId: string): Promise<string> {
  const { data: run } = await db.from("analysis_runs").select("notes, created_at").eq("id", runId).single();
  const stored = (run?.notes as { prediction_at?: unknown } | null)?.prediction_at;
  if (typeof stored === "string" && Number.isFinite(Date.parse(stored))) return stored;
  const fallback = run?.created_at ?? new Date().toISOString();
  const notes = { ...((run?.notes as Record<string, unknown> | null) ?? {}), prediction_at: fallback };
  await db.from("analysis_runs").update({ notes: notes as never }).eq("id", runId);
  return fallback;
}

export async function executeStep(runId: string, step: PipelineStepKey) {
  const db = await adminDb();
  await db
    .from("analysis_runs")
    .update({ current_step: step, status: "RUNNING", updated_at: new Date().toISOString() })
    .eq("id", runId);

  switch (step) {
    case "RESOLVE": return resolvePipelineMatches(db, runId);
    case "COLLECT": return collectPipelineData(db, runId);
    case "CLEAN": return clean(db, runId);
    case "FEATURES": return features(db, runId);
    case "PROBABILITY": return probability(db, runId);
    case "GATES": return gates(db, runId);
    case "MARKETS": return markets(db, runId);
  }
}

function sourceAgreement(perSource: Array<{ source: string; value: number }>): "SINGLE_SOURCE" | "CROSS_SOURCE_CONFIRMED" | "SOURCE_CONFLICT" {
  if (perSource.length < 2) return "SINGLE_SOURCE";
  const values = perSource.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return Math.abs(max - min) <= 0.1 ? "CROSS_SOURCE_CONFIRMED" : "SOURCE_CONFLICT";
}

async function clean(db: Db, runId: string) {
  const { data: raws } = await db
    .from("raw_observations")
    .select("id, match_id, source, metric, raw_value, fetched_at, definition_version")
    .eq("run_id", runId);
  await db.from("normalized_match_stats").delete().eq("run_id", runId);

  type RawValue = {
    value?: number;
    sourceLabel?: string;
    statScope?: "HOME" | "AWAY";
    contractCompatible?: boolean;
    note?: string;
    metricLabelRaw?: string;
    externalMatchId?: string;
    fixtureDate?: string;
    predictionAt?: string;
  };

  const buckets = new Map<string, {
    matchId: string | null;
    scope: string;
    metric: string;
    values: number[];
    perSource: Map<string, number[]>;
    definitionVersion: string | null;
    lineage: Array<Record<string, unknown>>;
  }>();
  let rejectedByDefinition = 0;
  const rejectedDetail: Record<string, number> = {};

  for (const r of raws ?? []) {
    const v = (r.raw_value ?? {}) as RawValue;
    if (typeof v.value !== "number" || !Number.isFinite(v.value)) continue;
    const [teamScope, canonical] = r.metric.split(":");
    if (!teamScope || !canonical) continue;
    if (v.contractCompatible !== true) {
      rejectedByDefinition += 1;
      const key = `${r.source}:${canonical}`;
      rejectedDetail[key] = (rejectedDetail[key] ?? 0) + 1;
      continue;
    }
    const key = `${r.match_id}|${teamScope}|${canonical}`;
    const bucket = buckets.get(key) ?? {
      matchId: r.match_id,
      scope: teamScope,
      metric: canonical,
      values: [],
      perSource: new Map<string, number[]>(),
      definitionVersion: r.definition_version,
      lineage: [],
    };
    bucket.values.push(v.value);
    const bySource = bucket.perSource.get(r.source) ?? [];
    bySource.push(v.value);
    bucket.perSource.set(r.source, bySource);
    bucket.lineage.push({
      rawObservationId: r.id,
      source: r.source,
      fetchedAt: r.fetched_at,
      rawValue: v.value,
      normalizedValue: v.value,
      canonicalMetric: canonical,
      metricLabelRaw: v.metricLabelRaw ?? v.sourceLabel ?? null,
      sourceLabel: v.sourceLabel ?? null,
      statScope: v.statScope ?? null,
      externalMatchId: v.externalMatchId ?? null,
      observedDate: v.fixtureDate ?? null,
      predictionAt: v.predictionAt ?? null,
      definitionVersion: r.definition_version,
      note: v.note ?? null,
    });
    buckets.set(key, bucket);
  }

  let conflicts = 0;
  let confirmed = 0;
  const rows = [...buckets.values()].map((b) => {
    const perSource = [...b.perSource.entries()].map(([source, values]) => ({
      source,
      value: values.reduce((a, c) => a + c, 0) / values.length,
      sampleSize: values.length,
    }));
    const status = sourceAgreement(perSource);
    if (status === "SOURCE_CONFLICT") conflicts += 1;
    if (status === "CROSS_SOURCE_CONFIRMED") confirmed += 1;
    return {
      run_id: runId,
      match_id: b.matchId,
      scope: b.scope,
      metric: b.metric,
      normalized_value: b.values.reduce((a, c) => a + c, 0) / b.values.length,
      sample_size: b.values.length,
      source: perSource.map((p) => p.source).join("+"),
      definition_version: b.definitionVersion,
      lineage: { observations: b.lineage, crossCheck: { status, perSource } } as never,
    };
  });

  for (let i = 0; i < rows.length; i += 200) {
    await db.from("normalized_match_stats").insert(rows.slice(i, i + 200));
  }

  await log(db, runId, "CLEAN", rows.length
    ? `${rows.length} métricas normalizadas; ${rejectedByDefinition} observações bloqueadas por definição.`
    : `Nenhuma métrica normalizada (${rejectedByDefinition} observações bloqueadas por definição).`,
  rows.length ? "INFO" : "WARN", { rejectedByDefinition, rejectedDetail, crossSourceConfirmed: confirmed, sourceConflicts: conflicts });

  return { normalized: rows.length, rejectedByDefinition, rejectedDetail, crossSourceConfirmed: confirmed, sourceConflicts: conflicts, rawObservations: raws?.length ?? 0 };
}

async function features(db: Db, runId: string) {
  const { count } = await db.from("normalized_match_stats").select("id", { count: "exact", head: true }).eq("run_id", runId);
  await log(db, runId, "FEATURES", count ? `${count} features normalizadas disponíveis.` : "Sem estatísticas normalizadas: nenhuma feature pôde ser construída.", count ? "INFO" : "WARN");
  return { features: count ?? 0 };
}

async function probability(db: Db, runId: string) {
  const prepared = await prepareExperimentalPredictionsForRun(db, runId);
  const { data: versions } = await db.from("model_versions").select("market_family, validation_status, calibration_version");
  const validated = (versions ?? []).filter((v) => v.validation_status === "PRODUCTION_VALIDATED" && v.calibration_version);

  if (prepared.predictionCount === 0) {
    await log(
      db,
      runId,
      "PROBABILITY",
      "Nenhuma previsão foi persistida; a análise não pode ser marcada como pronta para conferir odds.",
      "ERROR",
      { issues: prepared.issues, validatedFamilies: validated.length },
    );
    throw new Error("Nenhuma previsão pôde ser preparada com segurança para esta análise.");
  }

  await log(
    db,
    runId,
    "PROBABILITY",
    `${prepared.predictionCount} previsões experimentais persistidas em background. ${validated.length} família(s) com modelo de produção calibrado/validado.`,
    validated.length ? "INFO" : "WARN",
    {
      predictionCount: prepared.predictionCount,
      candidateCount: prepared.candidates.length,
      issues: prepared.issues,
      validatedFamilies: validated.length,
      modelStatus: prepared.modelStatus,
    },
  );
  return {
    predictionCount: prepared.predictionCount,
    candidateCount: prepared.candidates.length,
    issues: prepared.issues.length,
    validatedFamilies: validated.length,
  };
}

async function gates(db: Db, runId: string) {
  const label = percentageLabel(MIN_MODEL_PROBABILITY);
  await log(db, runId, "GATES", `Gate canônico de probabilidade: binários e asiáticos p_profit >= ${label}.`);
  return { gate: MIN_MODEL_PROBABILITY };
}

async function markets(db: Db, runId: string) {
  const { count: preparedPredictionCount, error: predictionCountError } = await db
    .from("model_predictions")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("model_status", EXPERIMENTAL_MARKETS_STATUS);
  if (predictionCountError) {
    throw new Error(`Falha ao validar previsões persistidas antes de READY_FOR_ODDS: ${predictionCountError.message}`);
  }
  if (!preparedPredictionCount) {
    throw new Error("READY_FOR_ODDS bloqueado: nenhuma previsão persistida para a análise.");
  }

  const predictionAt = await runPredictionAt(db, runId);
  const { data: matches } = await db
    .from("matches")
    .select("id, raw_partida, home_team, away_team, competition, kickoff_local")
    .eq("run_id", runId)
    .order("kickoff_local", { ascending: true });
  const { data: versions } = await db.from("model_versions").select("market_family, model_version, calibration_version, validation_status");
  const registry = new Map<string, ModelRegistryEntry>((versions ?? []).map((v) => [v.market_family, {
    family: v.market_family,
    modelVersion: v.model_version,
    calibrationVersion: v.calibration_version,
    validationStatus: v.validation_status,
  }]));
  const { data: normalized } = await db
    .from("normalized_match_stats")
    .select("match_id, metric, normalized_value, sample_size, source, definition_version")
    .eq("run_id", runId);

  await db.from("market_candidates").delete().eq("run_id", runId);
  let published = 0;
  let blocked = 0;
  let index = 0;

  for (const m of matches ?? []) {
    const ctx: MatchContext = {
      matchId: m.id,
      matchLabel: m.home_team && m.away_team ? `${m.home_team} x ${m.away_team}` : m.raw_partida,
      league: m.competition ?? "",
      kickoff: m.kickoff_local,
      predictionAt,
      features: new Map((normalized ?? []).filter((n) => n.match_id === m.id).map((n) => [n.metric, {
        metric: n.metric,
        value: Number(n.normalized_value ?? 0),
        sampleSize: n.sample_size ?? 0,
        source: n.source ?? "",
        definitionVersion: n.definition_version ?? "",
        definitionCompatible: true,
      }])),
      countDistributions: new Map(),
      binaryProbabilities: new Map(),
      sources: [],
    };

    const contracts = buildContracts({ home: m.home_team ?? "Mandante", away: m.away_team ?? "Visitante" });
    const rows = contracts.map((contract) => {
      index += 1;
      const out = evaluateContract(ctx, contract, registry, index);
      if (out.published) published += 1;
      else blocked += 1;
      return {
        run_id: runId,
        match_id: m.id,
        prediction_id: out.predictionId,
        market: out.market,
        market_family: out.family,
        participant: out.participant,
        side: out.side,
        line_raw: out.lineRaw,
        line_canonical: out.lineCanonical,
        market_label: out.marketLabel,
        p_cal: out.pCal,
        p_cons: out.pCons,
        fair_odd_info: out.fairOddInfo,
        confidence_score: out.confidenceScore,
        data_quality_score: out.dataQualityScore,
        sample_reliability: out.sampleReliability,
        uncertainty: out.uncertainty,
        stability: out.stability,
        market_score: out.marketScore,
        settlement_definition: out.settlementDefinition,
        model_status: out.modelStatus,
        data_status: out.dataStatus,
        published: out.published,
        block_reason: out.blockReason,
        reason_short: out.reasonShort,
        sources: out.sources as never,
      };
    });
    for (let i = 0; i < rows.length; i += 200) {
      await db.from("market_candidates").insert(rows.slice(i, i + 200));
    }
  }

  await db.from("analysis_runs").update({
    candidates_published: published,
    candidates_blocked: blocked,
    status: "READY_FOR_ODDS",
    current_step: "MARKETS",
    updated_at: new Date().toISOString(),
  }).eq("id", runId);
  await log(
    db,
    runId,
    "MARKETS",
    `${published} contratos de produção publicados, ${blocked} bloqueados; ${preparedPredictionCount} previsões experimentais já persistidas para conferência de odds.`,
    published ? "INFO" : "WARN",
    { provider: activeFootballProvider(), preparedPredictionCount },
  );
  return { published, blocked, preparedPredictionCount, provider: activeFootballProvider() };
}
