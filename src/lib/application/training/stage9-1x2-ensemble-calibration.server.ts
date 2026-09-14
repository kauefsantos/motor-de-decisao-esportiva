import { adminDb } from "../../admin-db";
import { callRuntimeRpc, type RuntimeRpcResult } from "../../repositories/runtime-rpc.server";
import { loadStage6GoalsValidationRows } from "./goals-validation.server";
import type { OneXTwoLabel, OneXTwoProbabilities } from "../../engine/multiclass-calibration";
import {
  STAGE9_1X2_CALIBRATION_VERSION,
  STAGE9_1X2_TARGET_MODEL,
  isStage9CalibrationParameters,
  runStage9OneXTwoCalibration,
  runStage9ProspectiveHoldout,
  type Stage9CalibrationParameters,
  type Stage9HoldoutFixture,
} from "./stage9-1x2-ensemble-calibration";

const PAGE_SIZE = 900;
const MAX_PAGES = 20;

type CalibrationArtifactRow = {
  calibration_version: string;
  status: string;
  parameters: unknown;
  fit_report: unknown;
  validation_status?: string | null;
};

type RawHoldoutRow = {
  fixture_id: number | string;
  prediction_id: string;
  prediction_at: string;
  fixture_date: string;
  league: string;
  side: string;
  raw_probability: number | string;
  calibrated_probability: number | string;
  home_goals: number | string;
  away_goals: number | string;
};

function finite(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid Stage 9 numeric value: ${String(value)}`);
  return parsed;
}

function label(value: string): OneXTwoLabel {
  if (value === "HOME" || value === "DRAW" || value === "AWAY") return value;
  throw new Error(`Invalid Stage 9 1X2 side: ${value}`);
}

function outcome(homeGoals: number, awayGoals: number): OneXTwoLabel {
  if (homeGoals > awayGoals) return "HOME";
  if (homeGoals === awayGoals) return "DRAW";
  return "AWAY";
}

export async function runStage9CalibrationValidation() {
  const rows = await loadStage6GoalsValidationRows();
  const report = runStage9OneXTwoCalibration(rows);
  const db = await adminDb();
  const status = report.readinessStatus === "SHADOW_READY" ? "SHADOW_READY" : "REJECTED";
  const response = await callRuntimeRpc<boolean>(db, "store_stage9_calibration_artifact", {
    p_market_family: "1X2",
    p_model_version: STAGE9_1X2_TARGET_MODEL,
    p_calibration_version: STAGE9_1X2_CALIBRATION_VERSION,
    p_status: status,
    p_parameters: report.calibrationFit?.parameters ?? {},
    p_report: report,
  });
  if (response.error || response.data !== true) {
    throw new Error(response.error?.message ?? "Stage 9 calibration artifact could not be persisted.");
  }
  return report;
}

export async function loadStage9ActiveCalibration(): Promise<{
  marketFamily: "1X2";
  modelVersion: string;
  calibrationVersion: string;
  parameters: Stage9CalibrationParameters;
  status: string;
  validationStatus: string | null;
} | null> {
  const db = await adminDb();
  const response = await callRuntimeRpc<CalibrationArtifactRow[]>(db, "get_stage9_active_calibration", {
    p_market_family: "1X2",
    p_model_version: STAGE9_1X2_TARGET_MODEL,
  });
  if (response.error) throw new Error(response.error.message);
  const row = response.data?.[0];
  if (!row || !isStage9CalibrationParameters(row.parameters)) return null;
  return {
    marketFamily: "1X2",
    modelVersion: STAGE9_1X2_TARGET_MODEL,
    calibrationVersion: row.calibration_version,
    parameters: row.parameters,
    status: row.status,
    validationStatus: row.validation_status ?? null,
  };
}

export async function loadStage9HoldoutRows(): Promise<Stage9HoldoutFixture[]> {
  const db = await adminDb();
  const rawRows: RawHoldoutRow[] = [];
  let afterPredictionAt: string | null = null;
  let afterPredictionId: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response: RuntimeRpcResult<RawHoldoutRow[]> = await callRuntimeRpc<RawHoldoutRow[]>(
      db,
      "get_stage9_1x2_holdout_rows_page",
      {
        p_after_prediction_at: afterPredictionAt,
        p_after_prediction_id: afterPredictionId,
        p_limit: PAGE_SIZE,
      },
    );
    if (response.error) throw new Error(response.error.message);
    const batch = response.data ?? [];
    rawRows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    const last = batch[batch.length - 1];
    if (!last) break;
    afterPredictionAt = last.prediction_at;
    afterPredictionId = last.prediction_id;
    if (page === MAX_PAGES - 1) throw new Error("Stage 9 holdout exceeded defensive pagination limit.");
  }

  const grouped = new Map<string, {
    predictionAt: string;
    fixtureDate: string;
    league: string;
    raw: Partial<OneXTwoProbabilities>;
    calibrated: Partial<OneXTwoProbabilities>;
    homeGoals: number;
    awayGoals: number;
  }>();

  for (const row of rawRows) {
    const fixtureId = String(row.fixture_id);
    const existing = grouped.get(fixtureId) ?? {
      predictionAt: row.prediction_at,
      fixtureDate: row.fixture_date.slice(0, 10),
      league: row.league,
      raw: {},
      calibrated: {},
      homeGoals: finite(row.home_goals),
      awayGoals: finite(row.away_goals),
    };
    if (existing.predictionAt !== row.prediction_at || existing.fixtureDate !== row.fixture_date.slice(0, 10)) {
      throw new Error(`Stage 9 fixture ${fixtureId} has inconsistent prediction identity.`);
    }
    const side = label(row.side);
    if (existing.raw[side] !== undefined || existing.calibrated[side] !== undefined) {
      throw new Error(`Stage 9 fixture ${fixtureId} has duplicate ${side} prediction.`);
    }
    existing.raw[side] = finite(row.raw_probability);
    existing.calibrated[side] = finite(row.calibrated_probability);
    grouped.set(fixtureId, existing);
  }

  const fixtures: Stage9HoldoutFixture[] = [];
  for (const [fixtureId, value] of grouped) {
    const raw = value.raw as Partial<OneXTwoProbabilities>;
    const calibrated = value.calibrated as Partial<OneXTwoProbabilities>;
    if (
      raw.HOME === undefined || raw.DRAW === undefined || raw.AWAY === undefined
      || calibrated.HOME === undefined || calibrated.DRAW === undefined || calibrated.AWAY === undefined
    ) continue;
    fixtures.push({
      fixtureId,
      predictionAt: value.predictionAt,
      fixtureDate: value.fixtureDate,
      league: value.league,
      raw: raw as OneXTwoProbabilities,
      calibrated: calibrated as OneXTwoProbabilities,
      outcome: outcome(value.homeGoals, value.awayGoals),
    });
  }
  return fixtures;
}

export async function runStage9HoldoutValidation() {
  const db = await adminDb();
  const artifactResponse = await callRuntimeRpc<CalibrationArtifactRow[]>(db, "get_stage9_active_calibration", {
    p_market_family: "1X2",
    p_model_version: STAGE9_1X2_TARGET_MODEL,
  });
  if (artifactResponse.error) throw new Error(artifactResponse.error.message);
  const artifact = artifactResponse.data?.[0];
  if (!artifact || artifact.calibration_version !== STAGE9_1X2_CALIBRATION_VERSION) {
    throw new Error("Stage 9 prospective holdout cannot start without the frozen SHADOW_READY calibrator.");
  }

  const rows = await loadStage9HoldoutRows();
  const report = runStage9ProspectiveHoldout(rows);
  const status = report.readinessStatus === "HOLDOUT_PASSED"
    ? "HOLDOUT_PASSED"
    : report.readinessStatus === "HOLDOUT_FAILED"
      ? "HOLDOUT_FAILED"
      : "SHADOW_READY";
  const response = await callRuntimeRpc<boolean>(db, "update_stage9_holdout_artifact", {
    p_market_family: "1X2",
    p_model_version: STAGE9_1X2_TARGET_MODEL,
    p_calibration_version: STAGE9_1X2_CALIBRATION_VERSION,
    p_status: status,
    p_holdout_report: report,
  });
  if (response.error || response.data !== true) {
    throw new Error(response.error?.message ?? "Stage 9 holdout result could not be persisted.");
  }

  let productionValidated = false;
  if (report.readinessStatus === "HOLDOUT_PASSED") {
    const promotion = await callRuntimeRpc<boolean>(db, "promote_stage9_1x2_if_holdout_passed", {});
    if (promotion.error || promotion.data !== true) {
      throw new Error(promotion.error?.message ?? "Stage 9 holdout passed but governed promotion failed.");
    }
    productionValidated = true;
  }

  return {
    ...report,
    calibrationFitReport: artifact.fit_report,
    promotion: {
      ...report.promotion,
      productionValidated,
      reason: productionValidated
        ? "Stage 9 untouched holdout passed and governed promotion set PRODUCTION_VALIDATED=true."
        : report.promotion.reason,
    },
  };
}
