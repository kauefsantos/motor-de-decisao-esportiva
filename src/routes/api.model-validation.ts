import { createFileRoute } from "@tanstack/react-router";

import { createFixedWindowRequestLimiter, readBoundedJsonObject } from "@/lib/analysis-worker-security";
import { backendErrorResponse, backendJson, backendRequestId } from "@/lib/backend-contract";
import { runStage4CornersValidation } from "@/lib/application/training/corners-validation.server";
import { callAdminRuntimeRpc } from "@/lib/repositories/runtime-rpc.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const enforceWorkerRateLimit = createFixedWindowRequestLimiter();

type ClaimRow = { accepted?: boolean | null; target_model_version?: string | null };

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
            "claim_stage4_model_validation",
            { p_job_id: jobId, p_dispatch_token: dispatchToken },
          );
          if (claimError) throw new Error(claimError.message);
          const claim = claimed?.[0];
          if (!claim?.accepted) return backendJson({ status: "IDLE" as const }, { status: 202 }, requestId);

          try {
            const report = await runStage4CornersValidation();
            const { data: completed, error: completeError } = await callAdminRuntimeRpc<boolean>(
              "complete_stage4_model_validation",
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
              targetModelVersion: claim.target_model_version ?? report.targetArtifact,
              readinessStatus: report.readinessStatus,
              eligiblePredictions: report.eligiblePredictions,
              nb2Predictions: report.nb2Predictions,
            }, undefined, requestId);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Falha desconhecida na validação quantitativa.";
            await callAdminRuntimeRpc("complete_stage4_model_validation", {
              p_job_id: jobId,
              p_dispatch_token: dispatchToken,
              p_report: {},
              p_error: message,
            });
            throw error;
          }
        } catch (error) {
          console.error("[Stage 4 model validation] failure", error);
          return backendErrorResponse(error, requestId);
        }
      },
    },
  },
});
