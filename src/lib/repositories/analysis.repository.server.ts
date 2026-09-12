import type { Json } from "@/integrations/supabase/types";
import type { AdminDb } from "../admin-db";
import { callRuntimeRpc } from "./runtime-rpc.server";

export type CreateAnalysisRunRow = { run_id: string; reused: boolean | null };

export async function createAnalysisRunAtomic(
  db: AdminDb,
  input: {
    ownerId: string;
    idempotencyKey: string;
    targetDate: string | null;
    filename: string;
    invalidCount: number;
    leagues: string[];
    headers: string[];
    rows: Array<{ partida: string; horario: string; campeonato: string }>;
  },
) {
  return callRuntimeRpc<CreateAnalysisRunRow[] | CreateAnalysisRunRow>(db, "create_analysis_run_atomic", {
    p_owner_id: input.ownerId,
    p_idempotency_key: input.idempotencyKey,
    p_target_date: input.targetDate,
    p_filename: input.filename,
    p_invalid_count: input.invalidCount,
    p_leagues: input.leagues,
    p_headers: input.headers,
    p_rows: input.rows,
  });
}

export async function replaceRunValueAnalysisAtomic(
  db: AdminDb,
  input: {
    runId: string;
    ownerId: string;
    userOdds: Array<Record<string, unknown>>;
    evaluations: Array<Record<string, unknown>>;
    selections: Array<Record<string, unknown>>;
  },
) {
  return callRuntimeRpc<unknown>(db, "replace_run_value_analysis_atomic", {
    p_run_id: input.runId,
    p_owner_id: input.ownerId,
    p_user_odds: input.userOdds,
    p_evaluations: input.evaluations,
    p_selections: input.selections,
  });
}

export type AuditMatch = {
  id: string;
  raw_partida: string;
  home_team: string | null;
  away_team: string | null;
  competition: string | null;
  kickoff_local: string | null;
  resolution_status: string | null;
  resolution_reason: string | null;
  resolver_confidence: number | null;
};

export type AuditExternalId = {
  match_id: string;
  source: string;
  external_id: string;
  confidence: number | null;
};

export type AuditNormalized = {
  match_id: string;
  scope: string;
  metric: string;
  normalized_value: number | null;
  sample_size: number | null;
  source: string;
  definition_version: string | null;
  lineage: Json;
};

export type AuditRaw = {
  match_id: string | null;
  source: string;
  metric: string;
  raw_value: Json;
  definition_version: string | null;
};

export async function loadRunAuditData(db: AdminDb, runId: string) {
  const matchesResult = await db
    .from("matches")
    .select("id,raw_partida,home_team,away_team,competition,kickoff_local,resolution_status,resolution_reason,resolver_confidence")
    .eq("run_id", runId);
  if (matchesResult.error) return { error: matchesResult.error, data: null };

  const matches = (matchesResult.data ?? []) as AuditMatch[];
  const matchIds = matches.map((match) => match.id);
  const externalIdsQuery = matchIds.length
    ? db.from("match_external_ids").select("match_id,source,external_id,confidence").in("match_id", matchIds)
    : Promise.resolve({ data: [] as AuditExternalId[], error: null });

  const [fetchesResult, externalIdsResult, normalizedResult, rawsResult, definitionsResult] = await Promise.all([
    db.from("source_fetches")
      .select("source,status,http_status,error_message,fetched_at,match_id")
      .eq("run_id", runId),
    externalIdsQuery,
    db.from("normalized_match_stats")
      .select("match_id,scope,metric,normalized_value,sample_size,source,definition_version,lineage")
      .eq("run_id", runId),
    db.from("raw_observations")
      .select("match_id,source,metric,raw_value,definition_version")
      .eq("run_id", runId),
    db.from("source_definitions").select("source,definition_version,notes,metric_definitions"),
  ]);

  const error = fetchesResult.error
    ?? externalIdsResult.error
    ?? normalizedResult.error
    ?? rawsResult.error
    ?? definitionsResult.error;
  if (error) return { error, data: null };

  return {
    error: null,
    data: {
      fetches: fetchesResult.data ?? [],
      matches,
      externalIds: (externalIdsResult.data ?? []) as AuditExternalId[],
      normalized: (normalizedResult.data ?? []) as AuditNormalized[],
      raws: (rawsResult.data ?? []) as AuditRaw[],
      definitions: definitionsResult.data ?? [],
    },
  };
}
