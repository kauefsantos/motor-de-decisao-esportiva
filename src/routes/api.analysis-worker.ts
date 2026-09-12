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
        return Response.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "Method Not Allowed" }, requestId }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
      },
      POST: async ({ request }) => {
        const requestId = backendRequestId();
        const rateLimited = enforceWorkerRateLimit(request);
        if (rateLimited) return rateLimited;
        const body = await readBoundedJsonObject(request);
        if (!body) return backendJson({ status: "IGNORED" as const }, { status: 202 }, requestId);
        const runId = typeof body["runId"] === "string" ? body["runId"] : "";
        const dispatchToken = typeof body["dispatchToken"] === "string" ? body["dispatchToken"] : "";
        if (!UUID_RE.test(runId) || !UUID_RE.test(dispatchToken)) return backendJson({ status: "IGNORED" as const }, { status: 202 }, requestId);

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const db = supabaseAdmin as any;
          const { data: claimed, error: claimError } = await db.rpc("claim_analysis_job", { p_run_id: runId, p_dispatch_token: dispatchToken });
          if (claimError) return Response.json({ ok: false, error: { code: "INTERNAL_ERROR", message: "Não foi possível reservar o processamento." }, requestId }, { status: 500, headers: { "Cache-Control": "no-store" } });
          const job = claimed?.[0];
          if (!job) return backendJson({ status: "IDLE" as const }, { status: 202 }, requestId);
          const leaseToken = String(job.lease_token ?? "");
          if (!UUID_RE.test(leaseToken)) return backendJson({ status: "LEASE_LOST" as const }, { status: 202 }, requestId);
          const completed = new Set<string>(job.completed_steps ?? []);

          const [{ PIPELINE_STEPS }, { executeStep }] = await Promise.all([
            import("@/lib/pipeline.steps"),
            import("@/lib/pipeline.server"),
          ]);
          const nextStep = PIPELINE_STEPS.find((step) => !completed.has(step.key));
          if (!nextStep) {
            const { data: finalRows } = await db.rpc("complete_analysis_job_step_atomic", { p_run_id: runId, p_lease_token: leaseToken, p_step: null, p_finished: true });
            const accepted = Boolean((Array.isArray(finalRows) ? finalRows[0] : finalRows)?.accepted);
            return backendJson({ status: accepted ? ("DONE" as const) : ("LEASE_LOST" as const), runId }, accepted ? undefined : { status: 202 }, requestId);
          }

          const { data: startedRows } = await db.rpc("start_analysis_job_step_atomic", { p_run_id: runId, p_lease_token: leaseToken, p_step: nextStep.key });
          if (!Boolean((Array.isArray(startedRows) ? startedRows[0] : startedRows)?.accepted)) {
            return backendJson({ status: "LEASE_LOST" as const, runId }, { status: 202 }, requestId);
          }

          let leaseLost = false;
          let heartbeatBusy = false;
          const heartbeat = async () => {
            if (heartbeatBusy || leaseLost) return;
            heartbeatBusy = true;
            try {
              const { data, error } = await db.rpc("heartbeat_analysis_job", { p_run_id: runId, p_lease_token: leaseToken });
              if (!error && data === false) leaseLost = true;
            } finally {
              heartbeatBusy = false;
            }
          };
          const heartbeatTimer = setInterval(() => void heartbeat(), 25_000);

          try {
            await executeStep(runId, nextStep.key);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Falha desconhecida no processamento.";
            const { data: failedRows } = await db.rpc("fail_analysis_job_atomic", { p_run_id: runId, p_lease_token: leaseToken, p_error: message.slice(0, 1000) });
            const accepted = Boolean((Array.isArray(failedRows) ? failedRows[0] : failedRows)?.accepted);
            if (accepted) await db.from("analysis_runs").update({ status: "ERROR", updated_at: new Date().toISOString() }).eq("id", runId);
            return Response.json({ ok: false, error: { code: accepted ? "INTERNAL_ERROR" : "CONFLICT", message: accepted ? "O processamento da análise falhou." : "O worker perdeu a reserva desta análise." }, requestId }, { status: accepted ? 500 : 409, headers: { "Cache-Control": "no-store" } });
          } finally {
            clearInterval(heartbeatTimer);
          }

          if (leaseLost) return backendJson({ status: "LEASE_LOST" as const, runId, step: nextStep.key }, { status: 202 }, requestId);
          completed.add(nextStep.key);
          const finished = completed.size === PIPELINE_STEPS.length;
          const { data: completeRows, error: completeError } = await db.rpc("complete_analysis_job_step_atomic", {
            p_run_id: runId,
            p_lease_token: leaseToken,
            p_step: nextStep.key,
            p_finished: finished,
          });
          if (completeError) throw completeError;
          const accepted = Boolean((Array.isArray(completeRows) ? completeRows[0] : completeRows)?.accepted);
          if (!accepted) return backendJson({ status: "LEASE_LOST" as const, runId, step: nextStep.key }, { status: 202 }, requestId);

          if (finished) {
            await db.rpc("enqueue_push_delivery_event", {
              p_event_key: `analysis-ready:${runId}`,
              p_user_id: job.user_id,
              p_event_type: "ANALYSIS_READY",
              p_payload: { runId },
            });
            await db.rpc("kick_push_delivery_dispatcher");
            return backendJson({ status: "DONE" as const, runId, step: nextStep.key }, undefined, requestId);
          }

          const { error: kickError } = await db.rpc("kick_analysis_worker");
          if (kickError) console.error("[Analysis worker] next-step dispatch failed", kickError);
          return backendJson({ status: "STEP_DONE" as const, runId, step: nextStep.key }, undefined, requestId);
        } catch (error) {
          console.error("[Analysis worker] unexpected failure", error);
          return backendErrorResponse(error, requestId);
        }
      },
    },
  },
});
