import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { BackendError } from "./backend-contract";

const runSchema = z.object({ runId: z.string().uuid() });
const NON_ENQUEUEABLE_RUN_STATUSES = new Set(["READY_FOR_ODDS", "COMPLETED"]);

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function authorizeRun(supabase: any, userId: string | undefined, runId: string) {
  const { assertRunOwner } = await import("./authorization.server");
  await assertRunOwner(supabase, userId, runId);
}

export const enqueueAnalysis = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => runSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);

    const supabase = await db();
    await authorizeRun(supabase, userId, data.runId);
    const { data: run, error: runError } = await supabase
      .from("analysis_runs")
      .select("id,status")
      .eq("id", data.runId)
      .eq("owner_id", userId)
      .single();
    if (runError || !run) throw new BackendError("NOT_FOUND", "Análise não encontrada.", 404);
    if (NON_ENQUEUEABLE_RUN_STATUSES.has(String(run.status ?? ""))) {
      return { status: "DONE" as const, created: false };
    }

    const { data: result, error } = await supabase.rpc("enqueue_analysis_job_atomic", {
      p_run_id: data.runId,
      p_user_id: userId,
    });
    if (error) throw new BackendError("INTERNAL_ERROR", "Não foi possível colocar a análise na fila.", 500);
    const row = Array.isArray(result) ? result[0] : result;
    const status = String(row?.status ?? "QUEUED");

    if (status === "ERROR") return { status: "ERROR" as const, created: Boolean(row?.created) };
    if (status === "DONE") return { status: "DONE" as const, created: Boolean(row?.created) };

    const { error: kickError } = await supabase.rpc("kick_analysis_worker");
    if (kickError) throw new BackendError("INTERNAL_ERROR", "A análise foi enfileirada, mas o worker não pôde ser acionado.", 500);
    return {
      status: status === "RUNNING" ? ("RUNNING" as const) : ("QUEUED" as const),
      created: Boolean(row?.created),
    };
  });

export const getProcessingStatus = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => runSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const supabase = await db();
    await authorizeRun(supabase, userId, data.runId);

    const [{ data: run, error: runError }, { data: job, error: jobError }, { data: logs, error: logError }] = await Promise.all([
      supabase
        .from("analysis_runs")
        .select("id,status,current_step,updated_at")
        .eq("id", data.runId)
        .eq("owner_id", userId)
        .single(),
      supabase
        .from("analysis_jobs")
        .select("status,current_step,completed_steps,attempts,last_error,updated_at")
        .eq("run_id", data.runId)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("pipeline_logs")
        .select("step,level,message,created_at")
        .eq("run_id", data.runId)
        .order("created_at", { ascending: true }),
    ]);

    if (runError || !run) throw new BackendError("NOT_FOUND", "Análise não encontrada.", 404);
    if (jobError || logError) throw new BackendError("INTERNAL_ERROR", "Não foi possível atualizar o andamento agora.", 500);
    return {
      run,
      job: job ?? null,
      logs: logs ?? [],
      ready: NON_ENQUEUEABLE_RUN_STATUSES.has(String(run.status ?? "")),
    };
  });

export const retryBackgroundAnalysis = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => runSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const supabase = await db();
    await authorizeRun(supabase, userId, data.runId);

    const { data: result, error } = await supabase.rpc("retry_analysis_job_atomic", {
      p_run_id: data.runId,
      p_user_id: userId,
    });
    if (error) throw new BackendError("INTERNAL_ERROR", "Não foi possível preparar a nova tentativa.", 500);
    const row = Array.isArray(result) ? result[0] : result;
    if (!row?.retried) {
      throw new BackendError(
        "CONFLICT",
        "Essa análise não está mais em estado de erro. Atualize o andamento antes de tentar novamente.",
        409,
      );
    }

    const { error: kickError } = await supabase.rpc("kick_analysis_worker");
    if (kickError) throw new BackendError("INTERNAL_ERROR", "A nova tentativa foi preparada, mas o worker não pôde ser acionado.", 500);
    return { ok: true, status: "QUEUED" as const };
  });
