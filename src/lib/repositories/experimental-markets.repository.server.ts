import type { AdminDb } from "../admin-db";
import {
  EXPERIMENTAL_MARKETS_STATUS,
  type ExperimentalMatch,
  type ExternalIdRow,
  type PredictionForAnalysis,
  type PredictionInsert,
  type TrackingInsert,
} from "../application/experimental-markets/contracts";

export async function loadExperimentalRun(db: AdminDb, runId: string) {
  const { data, error } = await db
    .from("analysis_runs")
    .select("notes,created_at,target_date")
    .eq("id", runId)
    .single();
  if (error || !data) throw new Error("Falha ao carregar a análise experimental.");
  return data;
}

export async function loadExperimentalMatches(
  db: AdminDb,
  runId: string,
): Promise<ExperimentalMatch[]> {
  const { data, error } = await db
    .from("matches")
    .select("id,raw_partida,home_team,away_team,competition,kickoff_local")
    .eq("run_id", runId)
    .order("kickoff_local", { ascending: true });
  if (error) throw new Error(`Falha ao carregar partidas experimentais: ${error.message}`);
  return (data ?? []) as ExperimentalMatch[];
}

export async function loadExperimentalExternalIds(
  db: AdminDb,
  matchIds: string[],
): Promise<ExternalIdRow[]> {
  const { data, error } = await db
    .from("match_external_ids")
    .select("match_id,source,external_id")
    .in("match_id", matchIds);
  if (error) throw new Error(`Falha ao carregar identificadores externos: ${error.message}`);
  return (data ?? []) as ExternalIdRow[];
}

export async function replaceExperimentalPredictions(
  db: AdminDb,
  runId: string,
  rows: PredictionInsert[],
) {
  const { error: deleteError } = await db
    .from("model_predictions")
    .delete()
    .eq("run_id", runId)
    .eq("model_status", EXPERIMENTAL_MARKETS_STATUS);
  if (deleteError) throw new Error(`Falha ao limpar model_predictions experimentais: ${deleteError.message}`);

  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await db.from("model_predictions").insert(rows.slice(index, index + 200));
    if (error) throw new Error(`Falha ao gravar model_predictions experimentais: ${error.message}`);
  }
}

export async function loadExperimentalOddsState(db: AdminDb, runId: string) {
  const [predictionResult, runResult] = await Promise.all([
    db
      .from("model_predictions")
      .select("prediction_id,market,participant,side,line_raw,line_canonical,model_probability,outcome_distribution,model_status,data_status,match_id,model_version")
      .eq("run_id", runId)
      .eq("model_status", EXPERIMENTAL_MARKETS_STATUS),
    db.from("analysis_runs").select("target_date").eq("id", runId).single(),
  ]);
  if (predictionResult.error) {
    throw new Error(`Falha ao carregar previsões experimentais: ${predictionResult.error.message}`);
  }
  if (runResult.error) throw new Error(`Falha ao carregar data-alvo: ${runResult.error.message}`);
  return {
    predictions: (predictionResult.data ?? []) as PredictionForAnalysis[],
    targetDate: runResult.data?.target_date ?? null,
  };
}

export async function loadExperimentalMatchesByIds(
  db: AdminDb,
  matchIds: string[],
): Promise<ExperimentalMatch[]> {
  if (matchIds.length === 0) return [];
  const { data, error } = await db
    .from("matches")
    .select("id,raw_partida,home_team,away_team,competition")
    .in("id", matchIds);
  if (error) throw new Error(`Falha ao carregar partidas selecionadas: ${error.message}`);
  return (data ?? []) as ExperimentalMatch[];
}

export async function upsertExperimentalTracking(db: AdminDb, rows: TrackingInsert[]) {
  if (rows.length === 0) return;
  const { error } = await db
    .from("experimental_bet_tracking")
    .upsert(rows, { onConflict: "run_id,prediction_id" });
  if (error) throw new Error(`Falha ao registrar ledger experimental: ${error.message}`);
}
