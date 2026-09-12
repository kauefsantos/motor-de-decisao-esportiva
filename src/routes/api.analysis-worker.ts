import { createFileRoute } from "@tanstack/react-router";

import { backendErrorResponse, backendJson, backendRequestId } from "@/lib/backend-contract";
import { createFixedWindowRequestLimiter, readBoundedJsonObject } from "@/lib/analysis-worker-security";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const enforceWorkerRateLimit = createFixedWindowRequestLimiter();

export const Route = createFileRoute("/api/analysis-worker")({
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
        const runId = typeof body.runId === "string" ? body.runId : "";
        const dispatchToken = typeof body.dispatchToken === "string" ? body.dispatchToken : "";
        if (!UUID_RE.test(runId) || !UUID_RE.test(dispatchToken)) {
          return backendJson({ status: "IGNORED" as const }, { status: 202 }, requestId);
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const db = supabaseAdmin;
          const { data: claimed, error: claimError } = await db.rpc("claim_analysis_job", {
            p_run_id: runId,
            p_dispatch_token: dispatchToken,
          });
          if (claimError) {
            console.error("[Analysis worker] claim failed", claimError);
            return Response.json(
              { ok: false, error: { code: "INTERNAL_ERROR", message: "Não foi possível reservar o processamento." }, requestId },
              { status: 500, headers: { "Cache-Control": "no-store" } },
            );
          }

          const job = claimed?.[0];
          if (!job) return backendJson({ status: "IDLE" as const }, { status: 202 }, requestId);
          const completed = new Set<string>(job.completed_steps ?? []);

          try {
            const [{ PIPELINE_STEPS }, { executeStep }] = await Promise.all([
              import("@/lib/pipeline.steps"),
              import("@/lib/pipeline.server"),
            ]);
            const nextStep = PIPELINE_STEPS.find((step) => !completed.has(step.key));
            if (!nextStep) {
              await db.from("analysis_jobs").update({
                status: "DONE", current_step: null, completed_at: new Date().toISOString(),
                locked_at: null, updated_at: new Date().toISOString(),
              }).eq("run_id", runId);
              return backendJson({ status: "DONE" as const, runId }, undefined, requestId);
            }

            await db.from("analysis_jobs").update({
              current_step: nextStep.key,
              locked_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }).eq("run_id", runId);

            await executeStep(runId, nextStep.key);
            completed.add(nextStep.key);
            const finished = completed.size === PIPELINE_STEPS.length;
            if (finished) {
              await db.from("analysis_jobs").update({
                status: "DONE", current_step: null, completed_steps: Array.from(completed),
                completed_at: new Date().toISOString(), locked_at: null, updated_at: new Date().toISOString(),
              }).eq("run_id", runId);
              try {
                const { sendAnalysisReadyPush } = await import("@/lib/push.server");
                await sendAnalysisReadyPush(job.user_id);
              } catch (pushError) {
                console.error("[Analysis worker] push failed", pushError);
              }
              return backendJson({ status: "DONE" as const, runId, step: nextStep.key }, undefined, requestId);
            }

            await db.from("analysis_jobs").update({
              status: "QUEUED", current_step: null, completed_steps: Array.from(completed),
              locked_at: null, updated_at: new Date().toISOString(),
            }).eq("run_id", runId);
            const { error: kickError } = await db.rpc("kick_analysis_worker");
            if (kickError) console.error("[Analysis worker] next-step dispatch failed", kickError);
            return backendJson({ status: "STEP_DONE" as const, runId, step: nextStep.key }, undefined, requestId);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Falha desconhecida no processamento.";
            console.error("[Analysis worker] pipeline failed", error);
            await Promise.all([
              db.from("analysis_jobs").update({
                status: "ERROR", last_error: message.slice(0, 1000), locked_at: null, updated_at: new Date().toISOString(),
              }).eq("run_id", runId),
              db.from("analysis_runs").update({ status: "ERROR", updated_at: new Date().toISOString() }).eq("id", runId),
            ]);
            return Response.json(
              { ok: false, error: { code: "INTERNAL_ERROR", message: "O processamento da análise falhou." }, requestId },
              { status: 500, headers: { "Cache-Control": "no-store" } },
            );
          }
        } catch (error) {
          console.error("[Analysis worker] unexpected failure", error);
          return backendErrorResponse(error, requestId);
        }
      },
    },
  },
});
