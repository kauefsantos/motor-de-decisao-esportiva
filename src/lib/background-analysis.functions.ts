import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const runSchema = z.object({ runId: z.string().uuid() });

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export const enqueueAnalysis = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => runSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Usuário não autenticado.");

    const supabase = await db();
    const { data: run, error: runError } = await supabase
      .from("analysis_runs")
      .select("id, status")
      .eq("id", data.runId)
      .single();
    if (runError || !run) throw new Error("Análise não encontrada.");

    if (run.status === "READY_FOR_ODDS") return { status: "DONE" as const };

    const { data: existing } = await supabase
      .from("analysis_jobs")
      .select("status")
      .eq("run_id", data.runId)
      .maybeSingle();

    if (!existing) {
      const { error } = await supabase.from("analysis_jobs").insert({
        run_id: data.runId,
        user_id: userId,
        status: "QUEUED",
      });
      if (error) throw error;
    } else if (existing.status === "ERROR") {
      // Preserve the failure so the processing screen can explain it and let the
      // user explicitly retry instead of silently restarting on every page load.
      return { status: "ERROR" as const };
    } else if (existing.status === "DONE") {
      return { status: "DONE" as const };
    }

    // pg_net queues this HTTP request inside PostgreSQL and returns immediately,
    // so the worker no longer depends on the phone keeping this request alive.
    const { error: kickError } = await supabase.rpc("kick_analysis_worker");
    if (kickError) throw kickError;
    return { status: existing?.status === "RUNNING" ? ("RUNNING" as const) : ("QUEUED" as const) };
  });

export const getProcessingStatus = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => runSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Usuário não autenticado.");
    const supabase = await db();

    const [{ data: run, error: runError }, { data: job }, { data: logs }] = await Promise.all([
      supabase
        .from("analysis_runs")
        .select("id, status, current_step, updated_at")
        .eq("id", data.runId)
        .single(),
      supabase
        .from("analysis_jobs")
        .select("status, current_step, completed_steps, attempts, last_error, updated_at")
        .eq("run_id", data.runId)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("pipeline_logs")
        .select("step, level, message, created_at")
        .eq("run_id", data.runId)
        .order("created_at", { ascending: true }),
    ]);

    if (runError || !run) throw new Error("Análise não encontrada.");
    return {
      run,
      job: job ?? null,
      logs: logs ?? [],
      ready: run.status === "READY_FOR_ODDS",
    };
  });

export const retryBackgroundAnalysis = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => runSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Usuário não autenticado.");
    const supabase = await db();

    const { error } = await supabase
      .from("analysis_jobs")
      .update({
        status: "QUEUED",
        current_step: null,
        last_error: null,
        locked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("run_id", data.runId)
      .eq("user_id", userId);
    if (error) throw error;

    await supabase
      .from("analysis_runs")
      .update({ status: "RUNNING", updated_at: new Date().toISOString() })
      .eq("id", data.runId);

    const { error: kickError } = await supabase.rpc("kick_analysis_worker");
    if (kickError) throw kickError;
    return { ok: true };
  });
