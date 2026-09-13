import type { AdminDb } from "../../admin-db";
import {
  EXPERIMENTAL_MARKETS_STATUS,
  PRODUCTION_STATUS,
  type ExperimentalCandidate,
  type RawValue,
  type RunRawRow,
} from "./contracts";
import { asRecord, buildDatasets } from "./datasets";
import { buildExperimentalPredictions } from "./prediction-service";
import {
  clearExperimentalPredictions,
  insertExperimentalPredictions,
  loadExperimentalExternalIds,
  loadExperimentalMatches,
  loadExperimentalRun,
} from "../../repositories/experimental-markets.repository.server";
import {
  loadFiveDollarRawValues,
  loadRunFiveDollarRawValues,
} from "../../raw-observations.server";

/**
 * Prepara e persiste as previsões experimentais de uma run usando exclusivamente
 * dados anteriores a prediction_at. É a fonte única para o worker em background
 * e para a retomada manual autenticada da interface.
 *
 * A função NÃO promove modelos: todas as linhas permanecem com
 * EXPERIMENTAL_CURRENT_SEASON / MODEL_NOT_PRODUCTION_VALIDATED até a etapa
 * explícita de validação de modelos.
 */
export async function prepareExperimentalPredictionsForRun(
  db: AdminDb,
  runId: string,
) {
  const run = await loadExperimentalRun(db, runId);
  const storedPredictionAt = (run.notes as { prediction_at?: unknown } | null)?.prediction_at;
  const predictionAt = typeof storedPredictionAt === "string" && Number.isFinite(Date.parse(storedPredictionAt))
    ? storedPredictionAt
    : run.created_at ?? new Date().toISOString();
  const predictionDate = predictionAt.slice(0, 10);

  const matches = await loadExperimentalMatches(db, runId);
  const matchIds = matches.map((match) => match.id);
  if (matchIds.length === 0) {
    return {
      candidates: [] as ExperimentalCandidate[],
      issues: ["Nenhuma partida encontrada na run."],
      predictionAt,
      predictionCount: 0,
      modelStatus: EXPERIMENTAL_MARKETS_STATUS,
      productionStatus: PRODUCTION_STATUS,
      calibrationVersion: null,
    };
  }

  const [externalIds, runRaws, historicalRaws] = await Promise.all([
    loadExperimentalExternalIds(db, matchIds),
    loadRunFiveDollarRawValues(db, runId),
    loadFiveDollarRawValues(db, predictionAt, 365),
  ]);
  const datasets = buildDatasets(
    historicalRaws
      .map((row) => asRecord(row.raw_value))
      .filter((row): row is RawValue => Boolean(row)),
  );

  // Substituição determinística da mesma família experimental. Linhas de outros
  // status/modelos não são removidas.
  await clearExperimentalPredictions(db, runId);
  const predictions = await buildExperimentalPredictions({
    runId,
    predictionAt,
    predictionDate,
    matches,
    externalIds,
    runRaws: runRaws as RunRawRow[],
    datasets,
  });
  await insertExperimentalPredictions(db, predictions.predictionRows);

  return {
    candidates: predictions.candidates,
    issues: predictions.issues,
    predictionAt,
    predictionCount: predictions.predictionRows.length,
    modelStatus: EXPERIMENTAL_MARKETS_STATUS,
    productionStatus: PRODUCTION_STATUS,
    calibrationVersion: null,
  };
}
