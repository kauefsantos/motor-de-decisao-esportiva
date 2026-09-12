import { createServerFn } from "@tanstack/react-start";

import { adminDb } from "./admin-db";
import { BackendError } from "./backend-contract";
import { callRuntimeRpc } from "./repositories/runtime-rpc.server";

type HomeMetricsRow = {
  open_bets_count: number | string | null;
  proposed_count: number | string | null;
  settled_profit: number | string | null;
  locked_stake: number | string | null;
};

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const getHomeSummary = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  const userId = context.userId;
  if (!userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);

  const db = await adminDb();

  const [metricsResult, recentRunsResult, draftResult, configResult] = await Promise.all([
    callRuntimeRpc<HomeMetricsRow[]>(db, "get_owner_home_metrics", { p_owner_id: userId }),
    db
      .from("analysis_runs")
      .select("id,target_date,status,current_step,matches_total,matches_resolved,matches_failed,selections_count,selection_finalized_at,created_at,updated_at")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(5),
    db
      .from("analysis_drafts")
      .select("id,target_date,status,filename,invalid_count,created_at,updated_at,final_run_id")
      .eq("owner_id", userId)
      .is("final_run_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("experimental_bankroll_config")
      .select("initial_bankroll")
      .eq("id", "main")
      .eq("owner_id", userId)
      .maybeSingle(),
  ]);

  if (metricsResult.error) throw new BackendError("INTERNAL_ERROR", "Não foi possível carregar suas pendências.", 500);
  if (recentRunsResult.error) throw new BackendError("INTERNAL_ERROR", "Não foi possível carregar suas análises recentes.", 500);
  if (draftResult.error) throw new BackendError("INTERNAL_ERROR", "Não foi possível carregar o rascunho em andamento.", 500);

  const metrics = metricsResult.data?.[0] ?? null;
  const openCount = num(metrics?.open_bets_count);
  const proposedCount = num(metrics?.proposed_count);
  const settledProfit = num(metrics?.settled_profit);
  const locked = num(metrics?.locked_stake);

  let availableBankroll: number | null = null;
  if (!configResult.error && configResult.data) {
    const initial = num(configResult.data.initial_bankroll);
    availableBankroll = Math.max(0, initial + settledProfit - locked);
  }

  const recentRuns = recentRunsResult.data ?? [];
  const resumableRun = recentRuns.find((run) => {
    if (run.selection_finalized_at) return false;
    return run.status === "RUNNING" || run.status === "READY_FOR_ODDS";
  }) ?? null;

  return {
    pendingDraft: draftResult.data ?? null,
    resumableRun,
    recentRuns,
    openBetsCount: openCount,
    proposedCount,
    availableBankroll,
  };
});
