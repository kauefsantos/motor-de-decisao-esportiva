import { adminDb } from "../../admin-db";
import { isOneXTwoIsotonicParameters } from "../../engine/multiclass-isotonic-calibration";
import { callRuntimeRpc, type RuntimeRpcResult } from "../../repositories/runtime-rpc.server";
import { loadStage6GoalsValidationRows } from "./goals-validation.server";
import {
  STAGE7_1X2_CALIBRATION_VERSION,
  STAGE7_1X2_TARGET_MODEL,
  runStage7OneXTwoCalibration,
  runStage7ProspectiveHoldout,
  type Stage7HoldoutFixture,
} from "./stage7-1x2-calibration";
import type { OneXTwoLabel, OneXTwoProbabilities } from "../../engine/multiclass-calibration";

const PAGE_SIZE = 900;
const MAX_PAGES = 20;

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

type CalibrationArtifactRow = {
  calibration_version: string;
  status: string;
  parameters: unknown;
  fit_report: unknown;
};

function finite(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid Stage 7 numeric value: ${String(value)}`);
  return parsed;
}

function label(value: string): OneXTwoLabel {
  if (value === "HOME" || value === "DRAW" || value === "AWAY") return value;
  throw new Error(`Invalid Stage 7 1X2 side: ${value}`);
}

function outcome(homeGoals: number, awayGoals: number): OneXTwoLabel {
  if (homeGoals > awayGoals) return "HOME";
  if (homeGoals === awayGoals) return "DRAW";
  return "AWAY";
}

export async function runStage7CalibrationValidation() {
  const rows = await loadStage6GoalsValidationRows();
  const report = runStage7OneXTwoCalibration(rows);
  const db = await adminDb();
  const status = report.readinessStatus === "SHADOW_READY" ? "SHADOW_READY" : "REJECTED";
  const response = await callRuntimeRpc<boolean>(db, "store_stage7_calibration_artifact", {
    p_market_family: "1X2",
    p_model_version: STAGE7_1X2_TARGET_MODEL,
    p_calibration_version: STAGE7_1X2_CALIBRATION_VERSION,
    p_status: status,
    p_parameters: report.calibrationFit?.parameters ?? {},
    p_report: report,
  });
  if (response.error || response.data !== true) {
    throw new Error(response.error?.message ?? "Stage 7 calibration artifact could not be persisted.");
  }
  return report;
}

export async function loadStage7HoldoutRows(calibrationVersion = STAGE7_1X2_CALIBRATION_VERSION): Promise<Stage7HoldoutFixture[]> {
  const db = await adminDb();
  const rawRows: RawHoldoutRow[] = [];
  let afterPredictionAt: string | null = null;
  let afterPredictionId: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response: RuntimeRpcResult<RawHoldoutRow[]> = await callRuntimeRpc<RawHoldoutRow[]>(
      db,
      "get_stage7_1x2_holdout_rows_page",
      {
        p_calibration_version: calibrationVersion,
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
    if (page === MAX_PAGES - 1) throw new Error("Stage 7 holdout exceeded defensive pagination limit.");
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
      throw new Error(`Stage 7 fixture ${fixtureId} has inconsistent prediction identity.`);
    }
    const side = label(row.side);
    if (existing.raw[side] !== undefined || existing.calibrated[side] !== undefined) {
      throw new Error(`Stage 7 fixture ${fixtureId} has duplicate ${side} prediction.`);
    }
    existing.raw[side] = finite(row.raw_probability);
    existing.calibrated[side] = finite(row.calibrated_probability);
    grouped.set(fixtureId, existing);
  }

  const fixtures: Stage7HoldoutFixture[] = [];
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

export async function loadStage7ActiveCalibration() {
  const db = await adminDb();
  const response = await callRuntimeRpc<CalibrationArtifactRow[]>(db, "get_stage7_active_calibration", {
    p_market_family: "1X2",
    p_model_version: STAGE7_1X2_TARGET_MODEL,
  });
  if (response.error) throw new Error(response.error.message);
  const row = response.data?.[0];
  if (!row) return null;

  const temperature = Number((row.parameters as { temperature?: unknown } | null)?.temperature);
  if (Number.isFinite(temperature) && temperature > 0) {
    return {
      marketFamily: "1X2" as const,
      modelVersion: STAGE7_1X2_TARGET_MODEL,
      calibrationVersion: row.calibration_version,
      method: "temperature_scaling" as const,
      temperature,
      status: row.status,
    };
  }
  if (isOneXTwoIsotonicParameters(row.parameters)) {
    return {
      marketFamily: "1X2" as const,
      modelVersion: STAGE7_1X2_TARGET_MODEL,
      calibrationVersion: row.calibration_version,
      method: "classwise_isotonic_blend" as const,
      parameters: row.parameters,
      status: row.status,
    };
  }
  return null;
}

export async function runStage7HoldoutValidation() {
  const db = await adminDb();
  const artifactResponse = await callRuntimeRpc<CalibrationArtifactRow[]>(db, "get_stage7_active_calibration", {
    p_market_family: "1X2",
    p_model_version: STAGE7_1X2_TARGET_MODEL,
  });
  if (artifactResponse.error) throw new Error(artifactResponse.error.message);
  const artifact = artifactResponse.data?.[0];
  if (!artifact || artifact.calibration_version !== STAGE7_1X2_CALIBRATION_VERSION) {
    throw new Error("Stage 7 prospective holdout cannot start without the frozen SHADOW_READY calibrator.");
  }

  const rows = await loadStage7HoldoutRows();
  const report = runStage7ProspectiveHoldout(rows);
  const status = report.readinessStatus === "HOLDOUT_PASSED"
    ? "HOLDOUT_PASSED"
    : report.readinessStatus === "HOLDOUT_FAILED"
      ? "HOLDOUT_FAILED"
      : "SHADOW_READY";
  const response = await callRuntimeRpc<boolean>(db, "update_stage7_holdout_artifact", {
    p_market_family: "1X2",
    p_model_version: STAGE7_1X2_TARGET_MODEL,
    p_calibration_version: STAGE7_1X2_CALIBRATION_VERSION,
    p_status: status,
    p_holdout_report: report,
  });
  if (response.error || response.data !== true) {
    throw new Error(response.error?.message ?? "Stage 7 holdout result could not be persisted.");
  }
  return {
    ...report,
    calibrationFitReport: artifact.fit_report,
  };
}
