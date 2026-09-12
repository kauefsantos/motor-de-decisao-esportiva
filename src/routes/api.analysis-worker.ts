import { createFileRoute } from "@tanstack/react-router";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_WORKER_BODY_BYTES = 1024;
const WORKER_RATE_LIMIT = 60;
const WORKER_RATE_WINDOW_MS = 60_000;
const MAX_RATE_BUCKETS = 2048;

type RateBucket = { count: number; resetAt: number };
const workerRateBuckets = new Map<string, RateBucket>();

function clientRateKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    forwarded ||
    "unknown";
  return candidate.slice(0, 128);
}

function pruneRateBuckets(now: number) {
  for (const [key, bucket] of workerRateBuckets) {
    if (bucket.resetAt <= now) workerRateBuckets.delete(key);
  }

  while (workerRateBuckets.size >= MAX_RATE_BUCKETS) {
    const oldest = workerRateBuckets.keys().next().value as string | undefined;
    if (!oldest) break;
    workerRateBuckets.delete(oldest);
  }
}

function enforceWorkerRateLimit(request: Request): Response | null {
  const now = Date.now();
  const key = clientRateKey(request);
  let bucket = workerRateBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    if (workerRateBuckets.size >= MAX_RATE_BUCKETS) pruneRateBuckets(now);
    bucket = { count: 1, resetAt: now + WORKER_RATE_WINDOW_MS };
    workerRateBuckets.set(key, bucket);
    return null;
  }

  bucket.count += 1;
  if (bucket.count <= WORKER_RATE_LIMIT) return null;

  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return Response.json(
    { status: "RATE_LIMITED" },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}

async function readBoundedWorkerPayload(
  request: Request,
): Promise<{ runId?: unknown; dispatchToken?: unknown } | null> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return null;

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_WORKER_BODY_BYTES) return null;
  }

  if (!request.body) return null;

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let raw = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_WORKER_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as { runId?: unknown; dispatchToken?: unknown };
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/analysis-worker")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(
          { error: "Method Not Allowed" },
          { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
        ),

      POST: async ({ request }) => {
        const rateLimited = enforceWorkerRateLimit(request);
        if (rateLimited) return rateLimited;

        const body = await readBoundedWorkerPayload(request);
        if (!body) {
          return Response.json(
            { status: "IGNORED" },
            { status: 202, headers: { "Cache-Control": "no-store" } },
          );
        }

        const runId = typeof body.runId === "string" ? body.runId : "";
        const dispatchToken = typeof body.dispatchToken === "string" ? body.dispatchToken : "";
        if (!UUID_RE.test(runId) || !UUID_RE.test(dispatchToken)) {
          return Response.json(
            { status: "IGNORED" },
            { status: 202, headers: { "Cache-Control": "no-store" } },
          );
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
