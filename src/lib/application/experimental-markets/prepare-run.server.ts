import type { AdminDb } from "../../admin-db";
import { applyOneXTwoClasswiseIsotonic } from "../../engine/multiclass-isotonic-calibration";
import { applyOneXTwoJointCalibration } from "../../engine/multiclass-joint-calibration";
import { applyOneXTwoTemperature, type OneXTwoProbabilities } from "../../engine/multiclass-calibration";
import {
  EXPERIMENTAL_MARKETS_STATUS,
  PRODUCTION_STATUS,
  type ExperimentalCandidate,
  type PredictionInsert,
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
import { loadStage7ActiveCalibration } from "../training/stage7-1x2-calibration.server";

async function applyStage7ShadowCalibration(rows: PredictionInsert[]) {
  let calibration: Awaited<ReturnType<typeof loadStage7ActiveCalibration>> = null;
  try {
    calibration = await loadStage7ActiveCalibration();
  } catch (error) {
    return {
      applied: 0,
      calibrationVersion: null,
      warning: `Stage 7 shadow calibration unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
  if (!calibration || calibration.status !== "SHADOW_READY" && calibration.status !== "HOLDOUT_PASSED") {
    return { applied: 0, calibrationVersion: null, warning: null };
  }

  const groups = new Map<string, PredictionInsert[]>();
  for (const row of rows) {
    if (row.market !== "1x2" || row.model_version !== calibration.modelVersion || !row.match_id) continue;
    const key = String(row.match_id);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  let applied = 0;
  for (const group of groups.values()) {
    const bySide = new Map(group.map((row) => [String(row.side), row]));
    const home = bySide.get("HOME");
    const draw = bySide.get("DRAW");
    const away = bySide.get("AWAY");
    if (!home || !draw || !away) continue;
    const raw: OneXTwoProbabilities = {
      HOME: Number(home.model_probability),
      DRAW: Number(draw.model_probability),
      AWAY: Number(away.model_probability),
    };
    if (!Object.values(raw).every(Number.isFinite)) continue;
    const calibrated = calibration.method === "temperature_scaling"
      ? applyOneXTwoTemperature(raw, calibration.temperature)
      : calibration.method === "classwise_isotonic_blend"
        ? applyOneXTwoClasswiseIsotonic(raw, calibration.parameters)
        : applyOneXTwoJointCalibration(raw, calibration.parameters);
    for (const [side, row] of [["HOME", home], ["DRAW", draw], ["AWAY", away]] as const) {
      row.p_cal = calibrated[side];
      row.calibration_version = calibration.calibrationVersion;
      // Shadow-only: model_status remains experimental and conservative_probability
      // remains null until an explicit governed production promotion.
      applied += 1;
    }
  }
  return { applied, calibrationVersion: calibration.calibrationVersion, warning: null };
}

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
  const stage7 = await applyStage7ShadowCalibration(predictions.predictionRows);
  if (stage7.warning) predictions.issues.push(stage7.warning);
  if (stage7.applied > 0) {
    predictions.issues.push(
      `Stage 7 shadow: ${stage7.applied} previsões 1X2 receberam calibração ${stage7.calibrationVersion}; o status segue experimental e stake real continua bloqueada.`,
    );
  }
  await insertExperimentalPredictions(db, predictions.predictionRows);

  return {
    candidates: predictions.candidates,
    issues: predictions.issues,
    predictionAt,
    predictionCount: predictions.predictionRows.length,
    modelStatus: EXPERIMENTAL_MARKETS_STATUS,
    productionStatus: PRODUCTION_STATUS,
    calibrationVersion: stage7.calibrationVersion,
  };
}
