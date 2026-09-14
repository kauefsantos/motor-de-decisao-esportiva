import { adminDb } from "../../admin-db";
import { callRuntimeRpc } from "../../repositories/runtime-rpc.server";
import { loadStage6GoalsValidationRows } from "./goals-validation.server";
import { loadStage7HoldoutRows } from "./stage7-1x2-calibration.server";
import {
  STAGE7B_1X2_CALIBRATION_VERSION,
  STAGE7B_1X2_TARGET_MODEL,
  runStage7BOneXTwoCalibration,
  runStage7BProspectiveHoldout,
} from "./stage7b-1x2-calibration";

type CalibrationArtifactRow = {
  calibration_version: string;
  status: string;
  parameters: unknown;
  fit_report: unknown;
};

export async function runStage7BCalibrationValidation() {
  const rows = await loadStage6GoalsValidationRows();
  const report = runStage7BOneXTwoCalibration(rows);
  const db = await adminDb();
  const status = report.readinessStatus === "SHADOW_READY" ? "SHADOW_READY" : "REJECTED";
  const response = await callRuntimeRpc<boolean>(db, "store_stage7b_calibration_artifact", {
    p_market_family: "1X2",
    p_model_version: STAGE7B_1X2_TARGET_MODEL,
    p_calibration_version: STAGE7B_1X2_CALIBRATION_VERSION,
    p_status: status,
    p_parameters: report.calibrationFit?.parameters ?? {},
    p_report: report,
  });
  if (response.error || response.data !== true) {
    throw new Error(response.error?.message ?? "Stage 7B calibration artifact could not be persisted.");
  }
  return report;
}

export async function runStage7BHoldoutValidation() {
  const db = await adminDb();
  const artifactResponse = await callRuntimeRpc<CalibrationArtifactRow[]>(db, "get_stage7_active_calibration", {
    p_market_family: "1X2",
    p_model_version: STAGE7B_1X2_TARGET_MODEL,
  });
  if (artifactResponse.error) throw new Error(artifactResponse.error.message);
  const artifact = artifactResponse.data?.[0];
  if (!artifact || artifact.calibration_version !== STAGE7B_1X2_CALIBRATION_VERSION) {
    throw new Error("Stage 7B prospective holdout cannot start without the frozen SHADOW_READY calibrator.");
  }

  const rows = await loadStage7HoldoutRows(STAGE7B_1X2_CALIBRATION_VERSION);
  const report = runStage7BProspectiveHoldout(rows);
  const status = report.readinessStatus === "HOLDOUT_PASSED"
    ? "HOLDOUT_PASSED"
    : report.readinessStatus === "HOLDOUT_FAILED"
      ? "HOLDOUT_FAILED"
      : "SHADOW_READY";
  const response = await callRuntimeRpc<boolean>(db, "update_stage7_holdout_artifact", {
    p_market_family: "1X2",
    p_model_version: STAGE7B_1X2_TARGET_MODEL,
    p_calibration_version: STAGE7B_1X2_CALIBRATION_VERSION,
    p_status: status,
    p_holdout_report: report,
  });
  if (response.error || response.data !== true) {
    throw new Error(response.error?.message ?? "Stage 7B holdout result could not be persisted.");
  }
  return {
    ...report,
    calibrationFitReport: artifact.fit_report,
  };
}
