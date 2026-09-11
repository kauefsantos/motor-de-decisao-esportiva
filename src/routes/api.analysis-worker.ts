import { createFileRoute } from "@tanstack/react-router";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/analysis-worker")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(
          { error: "Method Not Allowed" },
          { status: 405, headers: { Allow: "POST" } },
        ),

      POST: async ({ request }) => {
        let body: { runId?: unknown; dispatchToken?: unknown };
        try {
          body = (await request.json()) as { runId?: unknown; dispatchToken?: unknown };
        } catch {
          return Response.json({ status: "IGNORED" }, { status: 202 });
        }

        const runId = typeof body.runId === "string" ? body.runId : "";
        const dispatchToken = typeof body.dispatchToken === "string" ? body.dispatchToken : "";
        if (!UUID_RE.test(runId) || !UUID_RE.test(dispatchToken)) {
          return Response.json({ status: "IGNORED" }, { status: 202 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;
        const { data: claimed, error: claimError } = await db.rpc("claim_analysis_job", {
          p_run_id: runId,
          p_dispatch_token: dispatchToken,
        });

        if (claimError) {
          console.error("[Analysis worker] claim failed", claimError);
          return Response.json({ status: "ERROR" }, { status: 500 });
        }

        const job = claimed?.[0];
        if (!job) return Response.json({ status: "IDLE" }, { status: 202 });

        const completed = new Set<string>(job.completed_steps ?? []);

        try {
          const [{ PIPELINE_STEPS }, { executeStep }] = await Promise.all([
            import("@/lib/pipeline.steps"),
            import("@/lib/pipeline.server"),
          ]);
          const nextStep = PIPELINE_STEPS.find((step) => !completed.has(step.key));

          if (!nextStep) {
            await db
              .from("analysis_jobs")
              .update({
                status: "DONE",
                current_step: null,
                completed_at: new Date().toISOString(),
                locked_at: null,
                updated_at: new Date().toISOString(),
              })
              .eq("run_id", runId);
            return Response.json({ status: "DONE", runId });
          }

          await db
            .from("analysis_jobs")
            .update({
              current_step: nextStep.key,
              locked_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("run_id", runId);

          // One pipeline step per HTTP invocation keeps each server request bounded.
          // pg_net dispatches the next step after this one succeeds.
          await executeStep(runId, nextStep.key);
          completed.add(nextStep.key);

          const finished = completed.size === PIPELINE_STEPS.length;
          if (finished) {
            await db
              .from("analysis_jobs")
              .update({
                status: "DONE",
                current_step: null,
                completed_steps: Array.from(completed),
                completed_at: new Date().toISOString(),
                locked_at: null,
                updated_at: new Date().toISOString(),
              })
              .eq("run_id", runId);

            try {
              const { sendAnalysisReadyPush } = await import("@/lib/push.server");
              await sendAnalysisReadyPush(job.user_id);
            } catch (pushError) {
              // Notification failure must never roll the completed sports analysis back.
              console.error("[Analysis worker] push failed", pushError);
            }

            return Response.json({ status: "DONE", runId, step: nextStep.key });
          }

          await db
            .from("analysis_jobs")
            .update({
              status: "QUEUED",
              current_step: null,
              completed_steps: Array.from(completed),
              locked_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq("run_id", runId);

          const { error: kickError } = await db.rpc("kick_analysis_worker");
          if (kickError) {
            // The minute cron is a backstop, so a failed immediate dispatch does
            // not invalidate the successfully completed step.
            console.error("[Analysis worker] next-step dispatch failed", kickError);
          }

          return Response.json({ status: "STEP_DONE", runId, step: nextStep.key });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Falha desconhecida no processamento.";
          console.error("[Analysis worker] pipeline failed", error);

          await Promise.all([
            db
              .from("analysis_jobs")
              .update({
                status: "ERROR",
                last_error: message.slice(0, 1000),
                locked_at: null,
                updated_at: new Date().toISOString(),
              })
              .eq("run_id", runId),
            db
              .from("analysis_runs")
              .update({ status: "ERROR", updated_at: new Date().toISOString() })
              .eq("id", runId),
          ]);

          return Response.json({ status: "ERROR", runId }, { status: 500 });
        }
      },
    },
  },
});
