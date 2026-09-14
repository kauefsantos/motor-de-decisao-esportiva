import { createFileRoute } from "@tanstack/react-router";

import { runStage4CornersValidation } from "@/lib/application/training/corners-validation.server";
import { runStage6GoalsValidation } from "@/lib/application/training/goals-validation.server";
import { STAGE6_GOALS_PROTOCOL } from "@/lib/application/training/goals-walk-forward";
import {
  runStage7CalibrationValidation,
  runStage7HoldoutValidation,
} from "@/lib/application/training/stage7-1x2-calibration.server";
import {
  STAGE7_1X2_CALIBRATION_PROTOCOL,
  STAGE7_1X2_HOLDOUT_PROTOCOL,
} from "@/lib/application/training/stage7-1x2-calibration";
import {
  runStage7BCalibrationValidation,
  runStage7BHoldoutValidation,
} from "@/lib/application/training/stage7b-1x2-calibration.server";
import {
  STAGE7B_1X2_CALIBRATION_PROTOCOL,
  STAGE7B_1X2_HOLDOUT_PROTOCOL,
} from "@/lib/application/training/stage7b-1x2-calibration";
import {
  runStage7CCalibrationValidation,
  runStage7CHoldoutValidation,
} from "@/lib/application/training/stage7c-1x2-calibration.server";
import {
  STAGE7C_1X2_CALIBRATION_PROTOCOL,
  STAGE7C_1X2_HOLDOUT_PROTOCOL,
} from "@/lib/application/training/stage7c-1x2-calibration";
import { createFixedWindowRequestLimiter, readBoundedJsonObject } from "@/lib/analysis-worker-security";
import { backendErrorResponse, backendJson, backendRequestId } from "@/lib/backend-contract";
import { callAdminRuntimeRpc } from "@/lib/repositories/runtime-rpc.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const enforceWorkerRateLimit = createFixedWindowRequestLimiter();
const STAGE4_CORNERS_PROTOCOL = "stage4-corners-walk-forward-v1";

type ClaimRow = {
  accepted?: boolean | null;
  market_family?: string | null;
  target_model_version?: string | null;
  target_calibration_version?: string | null;
  protocol_version?: string | null;
};

type ValidationSummary = {
  targetArtifact: string;
  readinessStatus: string;
  eligiblePredictions: number;
  details?: Record<string, unknown>;
};

async function executeValidation(claim: ClaimRow): Promise<{ report: Record<string, unknown>; summary: ValidationSummary }> {
  const protocol = claim.protocol_version ?? "";
  if (protocol === STAGE4_CORNERS_PROTOCOL) {
    const report = await runStage4CornersValidation();
    return {
      report: report as unknown as Record<string, unknown>,
      summary: {
        targetArtifact: report.targetArtifact,
        readinessStatus: report.readinessStatus,
        eligiblePredictions: report.eligiblePredictions,
        details: { nb2Predictions: report.nb2Predictions },
      },
    };
  }
  if (protocol === STAGE6_GOALS_PROTOCOL) {
    const report = await runStage6GoalsValidation(
      claim.market_family ?? "",
      claim.target_model_version ?? "",
    );
    return {
      report: report as unknown as Record<string, unknown>,
      summary: {
        targetArtifact: report.targetArtifact,
        readinessStatus: report.readinessStatus,
        eligiblePredictions: report.eligiblePredictions,
        details: { marketFamily: report.marketFamily },
      },
    };
  }
  if (protocol === STAGE7_1X2_CALIBRATION_PROTOCOL) {
    const report = await runStage7CalibrationValidation();
    const eligiblePredictions = (report.calibrationFit?.sampleSize ?? 0) + (report.retrospective?.sampleSize ?? 0);
    return {
      report: report as unknown as Record<string, unknown>,
      summary: {
        targetArtifact: report.targetArtifact,
        readinessStatus: report.readinessStatus,
        eligiblePredictions,
        details: {
          marketFamily: report.marketFamily,
          calibrationVersion: report.calibrationVersion,
          prospectiveHoldoutStart: report.prospectiveHoldout.startsAt,
        },
      },
    };
  }
  if (protocol === STAGE7_1X2_HOLDOUT_PROTOCOL) {
    const report = await runStage7HoldoutValidation();
    return {
      report: report as unknown as Record<string, unknown>,
      summary: {
        targetArtifact: report.targetArtifact,
        readinessStatus: report.readinessStatus,
        eligiblePredictions: report.prospectiveHoldout.sampleSize,
        details: {
          marketFamily: report.marketFamily,
          calibrationVersion: report.calibrationVersion,
          requiredFixtures: report.prospectiveHoldout.requiredFixtures,
        },
      },
    };
  }
  if (protocol === STAGE7B_1X2_CALIBRATION_PROTOCOL) {
    const report = await runStage7BCalibrationValidation();
    const eligiblePredictions = (report.calibrationFit?.sampleSize ?? 0) + (report.retrospective?.sampleSize ?? 0);
    return {
      report: report as unknown as Record<string, unknown>,
      summary: {
        targetArtifact: report.targetArtifact,
        readinessStatus: report.readinessStatus,
        eligiblePredictions,
        details: {
          marketFamily: report.marketFamily,
          calibrationVersion: report.calibrationVersion,
          prospectiveHoldoutStart: report.prospectiveHoldout.startsAt,
        },
      },
    };
  }
  if (protocol === STAGE7B_1X2_HOLDOUT_PROTOCOL) {
    const report = await runStage7BHoldoutValidation();
    return {
      report: report as unknown as Record<string, unknown>,
      summary: {
        targetArtifact: report.targetArtifact,
        readinessStatus: report.readinessStatus,
        eligiblePredictions: report.prospectiveHoldout.sampleSize,
        details: {
          marketFamily: report.marketFamily,
          calibrationVersion: report.calibrationVersion,
          requiredFixtures: report.prospectiveHoldout.requiredFixtures,
        },
      },
    };
  }
  if (protocol === STAGE7C_1X2_CALIBRATION_PROTOCOL) {
    const report = await runStage7CCalibrationValidation();
    const eligiblePredictions = (report.calibrationFit?.sampleSize ?? 0) + (report.retrospective?.sampleSize ?? 0);
    return {
      report: report as unknown as Record<string, unknown>,
      summary: {
        targetArtifact: report.targetArtifact,
        readinessStatus: report.readinessStatus,
        eligiblePredictions,
        details: {
          marketFamily: report.marketFamily,
          calibrationVersion: report.calibrationVersion,
          prospectiveHoldoutStart: report.prospectiveHoldout.startsAt,
        },
      },
    };
  }
  if (protocol === STAGE7C_1X2_HOLDOUT_PROTOCOL) {
    const report = await runStage7CHoldoutValidation();
    return {
      report: report as unknown as Record<string, unknown>,
      summary: {
        targetArtifact: report.targetArtifact,
        readinessStatus: report.readinessStatus,
        eligiblePredictions: report.prospectiveHoldout.sampleSize,
        details: {
          marketFamily: report.marketFamily,
          calibrationVersion: report.calibrationVersion,
          requiredFixtures: report.prospectiveHoldout.requiredFixtures,
        },
      },
    };
  }
  throw new Error(`Unsupported model-validation protocol: ${protocol || "missing"}`);
}

export const Route = createFileRoute("/api/model-validation")({
  server: {
    handlers: {
      GET: async () => {
        const requestId = backendRequestId();
        return Response.json(
          { ok: false, error: { code: "VALIDATION_ERROR", message: "Method Not Allowed" }, requestId },
          { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
        );
      },
      POST: async ({ request }) => {
        const requestId = backendRequestId();
        const rateLimited = enforceWorkerRateLimit(request);
        if (rateLimited) return rateLimited;
        const body = await readBoundedJsonObject(request);
        if (!body) return backendJson({ status: "IGNORED" as const }, { status: 202 }, requestId);
        const jobId = typeof body["jobId"] === "string" ? body["jobId"] : "";
        const dispatchToken = typeof body["dispatchToken"] === "string" ? body["dispatchToken"] : "";
        if (!UUID_RE.test(jobId) || !UUID_RE.test(dispatchToken)) {
          return backendJson({ status: "IGNORED" as const }, { status: 202 }, requestId);
        }

        try {
          const { data: claimed, error: claimError } = await callAdminRuntimeRpc<ClaimRow[]>(
            "claim_model_validation",
            { p_job_id: jobId, p_dispatch_token: dispatchToken },
          );
          if (claimError) throw new Error(claimError.message);
          const claim = claimed?.[0];
          if (!claim?.accepted) return backendJson({ status: "IDLE" as const }, { status: 202 }, requestId);

          try {
            const { report, summary } = await executeValidation(claim);
            const { data: completed, error: completeError } = await callAdminRuntimeRpc<boolean>(
              "complete_model_validation",
              {
                p_job_id: jobId,
                p_dispatch_token: dispatchToken,
                p_report: report,
                p_error: null,
              },
            );
            if (completeError || completed !== true) throw new Error(completeError?.message ?? "Falha ao persistir validação.");
            return backendJson({
              status: "DONE" as const,
              jobId,
              targetModelVersion: claim.target_model_version ?? summary.targetArtifact,
              targetCalibrationVersion: claim.target_calibration_version ?? null,
              readinessStatus: summary.readinessStatus,
              eligiblePredictions: summary.eligiblePredictions,
              ...summary.details,
            }, undefined, requestId);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Falha desconhecida na validação quantitativa.";
            await callAdminRuntimeRpc("complete_model_validation", {
              p_job_id: jobId,
              p_dispatch_token: dispatchToken,
              p_report: {},
              p_error: message,
            });
            throw error;
          }
        } catch (error) {
          console.error("[Model validation] failure", error);
          return backendErrorResponse(error, requestId);
        }
      },
    },
  },
});
