import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { adminDb, type AdminDb } from "./admin-db";
import { BackendError } from "./backend-contract";
import { evaluateValue, finalSelection, type ValueInput } from "./engine/value";
import type { AsianOutcomeProbabilities } from "./engine/types";
import { PIPELINE_STEPS, type PipelineStepKey } from "./pipeline.steps";
import {
  createAnalysisRunAtomic,
  loadRunAuditData,
  replaceRunValueAnalysisAtomic,
  type AuditNormalized,
  type AuditRaw,
} from "./repositories/analysis.repository.server";

const rowSchema = z.object({
  partida: z.string().trim().min(1).max(160),
  horario: z.string().trim().min(1).max(32),
  campeonato: z.string().trim().min(1).max(120),
});

const createRunSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
  filename: z.string().trim().min(1).max(200),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  headers: z.array(z.string().max(80)).max(30),
  invalidCount: z.number().int().min(0),
  leagues: z.array(z.string().max(120)).max(200),
  rows: z.array(rowSchema).min(1).max(300),
});

async function authorizeRun(db: AdminDb, userId: string | undefined, runId: string) {
  const { assertRunOwner } = await import("./authorization.server");
  await assertRunOwner(db, userId, runId);
}

async function legacyIdempotencyKey(userId: string, data: z.infer<typeof createRunSchema>) {
  if (data.idempotencyKey) return data.idempotencyKey;
  const { createHash } = await import("node:crypto");
  // Existing UI does not yet send a client key. A one-minute payload bucket
  // absorbs double-click/network retries while still allowing an intentional rerun.
  const bucket = Math.floor(Date.now() / 60_000);
  const digest = createHash("sha256")
    .update(JSON.stringify({ userId, bucket, filename: data.filename, targetDate: data.targetDate, rows: data.rows }))
    .digest("hex")
    .slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export const createRun = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => createRunSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const db = await adminDb();
    const idempotencyKey = await legacyIdempotencyKey(userId, data);
    const { data: result, error } = await createAnalysisRunAtomic(db, {
      ownerId: userId,
      idempotencyKey,
      targetDate: data.targetDate,
      filename: data.filename,
      invalidCount: data.invalidCount,
      leagues: data.leagues,
      headers: data.headers,
      rows: data.rows,
    });
    if (error) throw new BackendError("VALIDATION_ERROR", "Não foi possível criar a análise com todas as partidas.", 400);
    const row = Array.isArray(result) ? result[0] : result;
    if (!row?.run_id) throw new BackendError("INTERNAL_ERROR", "A criação da análise não retornou um identificador.", 500);
    return { runId: String(row.run_id), reused: Boolean(row.reused), steps: PIPELINE_STEPS.map((step) => ({ ...step })) };
  });

export const runStep = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      runId: z.string().uuid(),
      step: z.enum(PIPELINE_STEPS.map((step) => step.key) as [PipelineStepKey, ...PipelineStepKey[]]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await adminDb();
    await authorizeRun(db, context.userId, data.runId);
    const { executeStep } = await import("./pipeline.server");
    const result = await executeStep(data.runId, data.step);
    const { data: logs } = await db
      .from("pipeline_logs")
      .select("step,level,message,payload")
      .eq("run_id", data.runId)
      .eq("step", data.step)
      .order("created_at", { ascending: false })
      .limit(1);
    return { step: data.step, result, log: logs?.[0] ?? null };
  });

export const getRun = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await adminDb();
    await authorizeRun(db, context.userId, data.runId);
    const [{ data: run, error: runError }, { data: candidates, error: candidateError }, { data: logs, error: logError }, { data: fetches, error: fetchError }] =
      await Promise.all([
        db.from("analysis_runs").select("*").eq("id", data.runId).single(),
        db.from("market_candidates")
          .select("id,prediction_id,market,market_family,market_label,participant,side,line_raw,line_canonical,p_cal,p_cons,fair_odd_info,confidence_score,data_quality_score,sample_reliability,uncertainty,stability,market_score,settlement_definition,model_status,data_status,published,block_reason,reason_short,match_id")
          .eq("run_id", data.runId)
          .order("market_score", { ascending: false, nullsFirst: false }),
        db.from("pipeline_logs").select("step,level,message,payload,created_at").eq("run_id", data.runId).order("created_at", { ascending: true }),
        db.from("source_fetches").select("source,status").eq("run_id", data.runId),
      ]);
    if (runError || candidateError || logError || fetchError) {
      throw new BackendError("INTERNAL_ERROR", "Não foi possível carregar a análise completa.", 500);
    }

    const { data: matches, error: matchError } = await db
      .from("matches")
      .select("id,raw_partida,home_team,away_team,competition,kickoff_local,resolution_status")
      .eq("run_id", data.runId);
    if (matchError) throw new BackendError("INTERNAL_ERROR", "Não foi possível carregar as partidas.", 500);

    const sourceSummary: Record<string, number> = {};
    for (const fetch of fetches ?? []) {
      const key = `${fetch.source} · ${fetch.status}`;
      sourceSummary[key] = (sourceSummary[key] ?? 0) + 1;
    }
    return { run, candidates: candidates ?? [], matches: matches ?? [], logs: logs ?? [], sourceSummary };
  });

const oddsSchema = z.object({
  runId: z.string().uuid(),
  entries: z.array(z.object({
    candidateId: z.string().uuid(),
    odd: z.number().finite().gt(1).lt(1000),
    lineAtEntry: z.number().finite().nullable(),
  })).min(1).max(500),
});

type OddsCandidate = {
  id: string;
  prediction_id: string;
  market: string;
  market_family: string;
  market_label: string;
  line_canonical: number | string | null;
  p_cons: number | string | null;
  published: boolean;
  model_status: string;
  data_status: string;
  match_id: string | null;
  confidence_score: number | null;
  data_quality_score: number | null;
  reason_short: string | null;
};

type PredictionDistributionRow = {
  prediction_id: string;
  outcome_distribution: unknown;
};

export const analyzeOdds = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => oddsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const db = await adminDb();
    await authorizeRun(db, userId, data.runId);
    const ids = data.entries.map((entry) => entry.candidateId);
    const [{ data: candidateData, error: candidateError }, { data: predictionData, error: predictionError }] = await Promise.all([
      db.from("market_candidates")
        .select("id,prediction_id,market,market_family,market_label,line_canonical,p_cons,published,model_status,data_status,match_id,confidence_score,data_quality_score,reason_short")
        .eq("run_id", data.runId)
        .in("id", ids),
      db.from("model_predictions").select("prediction_id,outcome_distribution").eq("run_id", data.runId),
    ]);
    if (candidateError || predictionError) {
      throw new BackendError("INTERNAL_ERROR", "Não foi possível preparar a comparação de odds.", 500);
    }

    const candidates = (candidateData ?? []) as OddsCandidate[];
    const predictions = (predictionData ?? []) as PredictionDistributionRow[];
    const distByPrediction = new Map<string, AsianOutcomeProbabilities | null>(
      predictions.map((prediction) => [
        prediction.prediction_id,
        (prediction.outcome_distribution ?? null) as AsianOutcomeProbabilities | null,
      ]),
    );
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const evaluations: Array<{ result: ReturnType<typeof evaluateValue>; candidate: OddsCandidate }> = [];
    const oddsRows: Array<Record<string, unknown>> = [];

    for (const entry of data.entries) {
      const candidate = byId.get(entry.candidateId);
      if (!candidate) continue;
      oddsRows.push({ candidate_id: candidate.id, odd: entry.odd, line_at_entry: entry.lineAtEntry });
      const input: ValueInput = {
        candidateId: candidate.id,
        predictionId: candidate.prediction_id,
        contractType: candidate.market_family === "1X2" || candidate.market_family === "BTTS" ? "BINARY" : "ASIAN",
        bookmaker: "bet365_br",
        odd: entry.odd,
        lineAtEntry: entry.lineAtEntry,
        lineCanonical: candidate.line_canonical === null ? null : Number(candidate.line_canonical),
        pCons: candidate.p_cons === null ? null : Number(candidate.p_cons),
        outcomeDistribution: distByPrediction.get(candidate.prediction_id) ?? null,
        published: candidate.published,
        modelStatus: candidate.model_status,
        dataStatus: candidate.data_status,
      };
      evaluations.push({ result: evaluateValue(input), candidate });
    }

    const selected = finalSelection(evaluations.map((item) => item.result));
    const selections: Array<(typeof selected)[number] & {
      rank: number;
      explanation: string;
      matchId: string | null;
      marketLabel: string;
      confidenceScore: number | null;
      dataQualityScore: number | null;
    }> = [];
    const selectionRows: Array<Record<string, unknown>> = [];
    let rank = 0;
    for (const selection of selected) {
      rank += 1;
      const match = evaluations.find((item) => item.result.candidateId === selection.candidateId);
      const explanation = `Probabilidade conservadora ${(((selection.wEff ?? (match?.candidate.p_cons ? Number(match.candidate.p_cons) : 0)) * 100)).toFixed(1)}% contra ${(100 / selection.odd).toFixed(1)}% implícitos na odd; EV conservador ${(((selection.evCons ?? 0) * 100)).toFixed(2)}%.`;
      selectionRows.push({ candidate_id: selection.candidateId, rank, explanation });
      selections.push({
        ...selection,
        rank,
        explanation,
        matchId: match?.candidate.match_id ?? null,
        marketLabel: match?.candidate.market_label ?? "",
        confidenceScore: match?.candidate.confidence_score ?? null,
        dataQualityScore: match?.candidate.data_quality_score ?? null,
      });
    }

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

    const persistResult = await replaceRunValueAnalysisAtomic(db, {
      runId: data.runId,
      ownerId: userId,
      userOdds: oddsRows,
      evaluations: evaluationRows,
      selections: selectionRows,
    });
    if (persistResult.error) {
      throw new BackendError("CONFLICT", "As odds mudaram durante o processamento. Atualize e tente novamente.", 409);
    }

    const selectedIds = new Set(selections.map((selection) => selection.candidateId));
    const rejected = evaluations
      .filter((item) => !selectedIds.has(item.result.candidateId))
      .map((item) => ({
        ...item.result,
        marketLabel: item.candidate.market_label,
        matchId: item.candidate.match_id,
      }));
    return { selections, rejected };
  });

export const getResults = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await adminDb();
    await authorizeRun(db, context.userId, data.runId);
    const [{ data: evaluations, error: evaluationError }, { data: selections, error: selectionError }] = await Promise.all([
      db.from("value_evaluations").select("*").eq("run_id", data.runId),
      db.from("final_selections").select("*").eq("run_id", data.runId).order("rank", { ascending: true }),
    ]);
    if (evaluationError || selectionError) {
      throw new BackendError("INTERNAL_ERROR", "Não foi possível carregar os resultados.", 500);
    }
    const ids = (evaluations ?? []).map((evaluation) => evaluation.candidate_id);
    const { data: candidates } = ids.length
      ? await db.from("market_candidates")
          .select("id,prediction_id,market_label,match_id,confidence_score,data_quality_score,settlement_definition,reason_short")
          .in("id", ids)
      : { data: [] };
    const { data: matches } = await db
      .from("matches")
      .select("id,raw_partida,home_team,away_team,competition,kickoff_local")
      .eq("run_id", data.runId);
    return { evaluations: evaluations ?? [], selections: selections ?? [], candidates: candidates ?? [], matches: matches ?? [] };
  });

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

function researchValue(raw: AuditRaw): ResearchRaw {
  const value = raw.raw_value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as ResearchRaw;
}

function crossCheckStatus(row: AuditNormalized) {
  const lineage = row.lineage;
  if (!lineage || typeof lineage !== "object" || Array.isArray(lineage)) return "";
  const crossCheck = (lineage as Record<string, unknown>)["crossCheck"];
  if (!crossCheck || typeof crossCheck !== "object" || Array.isArray(crossCheck)) return "";
  const status = (crossCheck as Record<string, unknown>)["status"];
  return typeof status === "string" ? status : "";
}

/** Auditoria da ingestão: estado por fonte e detalhe de resolução/coleta por partida. */
export const getAudit = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await adminDb();
    await authorizeRun(db, context.userId, data.runId);
    const auditResult = await loadRunAuditData(db, data.runId);
    if (auditResult.error || !auditResult.data) {
      throw new BackendError("INTERNAL_ERROR", "Não foi possível carregar a auditoria das fontes.", 500);
    }

    const { fetches, matches, externalIds, normalized, raws, definitions } = auditResult.data;
    const matchIds = new Set(matches.map((match) => match.id));
    const sources = new Map<string, {
      source: string;
      ok: number;
      unavailable: number;
      notConfigured: number;
      lastFetchedAt: string | null;
      lastError: string | null;
    }>();
    for (const fetch of fetches) {
      const source = sources.get(fetch.source) ?? {
        source: fetch.source,
        ok: 0,
        unavailable: 0,
        notConfigured: 0,
        lastFetchedAt: null,
        lastError: null,
      };
      if (fetch.status === "OK") source.ok += 1;
      else if (fetch.status === "NOT_CONFIGURED") source.notConfigured += 1;
      else source.unavailable += 1;
      if (!source.lastFetchedAt || (fetch.fetched_at && fetch.fetched_at > source.lastFetchedAt)) {
        source.lastFetchedAt = fetch.fetched_at;
      }
      if (fetch.error_message) source.lastError = fetch.error_message;
      sources.set(fetch.source, source);
    }

    const researchRaws = raws.filter((raw) => raw.source === "research_adapter");
    const researchMode = definitions.find((definition) => definition.source === "research_adapter")?.notes
      ?? "Desk Research / Dados Públicos";

    const perMatch = matches.map((match) => {
      const mine = researchRaws.filter((raw) => raw.match_id === match.id);
      const accepted = new Map<string, number>();
      const rejected = new Map<string, { count: number; note: string | null }>();
      const fixtures = new Map<string, { date: string; team: string; opponent: string }>();
      const urls = new Set<string>();
      let historyStatus: string | null = null;
      let reused = 0;
      for (const raw of mine) {
        const value = researchValue(raw);
        const canonical = raw.metric.split(":")[1] ?? raw.metric;
        if (value.sourceUrl) urls.add(value.sourceUrl);
        if (value.historyStatus) historyStatus = value.historyStatus;
        if (value.reusedFromCache) reused += 1;
        if (value.externalMatchId) {
          fixtures.set(value.externalMatchId, {
            date: value.fixtureDate ?? "—",
            team: value.team ?? "—",
            opponent: value.opponent ?? "—",
          });
        }
        if (value.contractCompatible === true) {
          accepted.set(canonical, (accepted.get(canonical) ?? 0) + 1);
        } else {
          const previous = rejected.get(canonical);
          rejected.set(canonical, {
            count: (previous?.count ?? 0) + 1,
            note: value.note ?? previous?.note ?? null,
          });
        }
      }
      return {
        ...match,
        externalIds: externalIds.filter((external) => external.match_id === match.id),
        normalized: normalized.filter((row) => row.match_id === match.id),
        research: mine.length > 0 ? {
          mode: researchMode,
          urls: [...urls],
          historyStatus,
          reusedFromCache: reused,
          fixtures: [...fixtures.entries()].map(([id, fixture]) => ({ id, ...fixture })),
          accepted: [...accepted.entries()].map(([metric, count]) => ({ metric, count })),
          rejected: [...rejected.entries()].map(([metric, item]) => ({ metric, count: item.count, note: item.note })),
        } : null,
      };
    });

    const researchActive = researchRaws.length > 0 || fetches.some((fetch) => fetch.source === "research_adapter");
    return {
      mode: researchActive ? "Desk Research / Dados Públicos" : "APIs configuradas",
      sources: [...sources.values()].map((source) => ({
        ...source,
        status: source.ok > 0
          ? (source.unavailable > 0 ? "PARTIAL" : "OK")
          : source.notConfigured > 0 && source.unavailable === 0
            ? "NOT_CONFIGURED"
            : "UNAVAILABLE",
      })),
      resolvedEvents: externalIds.filter(
        (external) => external.source === "api_football_fixture" && matchIds.has(external.match_id),
      ).length,
      researchResolved: new Set(
        externalIds
          .filter((external) => external.source === "research_team_home" && matchIds.has(external.match_id))
          .map((external) => external.match_id),
      ).size,
      normalizedObservations: normalized.length,
      rawObservations: raws.length,
      crossChecked: normalized.filter((row) => crossCheckStatus(row) === "CROSS_SOURCE_CONFIRMED").length,
      sourceConflicts: normalized.filter((row) => crossCheckStatus(row) === "SOURCE_CONFLICT").length,
      matches: perMatch,
    };
  });
