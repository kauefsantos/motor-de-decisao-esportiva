import { createServerFn } from "@tanstack/react-start";

type DbRow = Record<string, any>;

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const getHomeSummary = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  const userId = context.userId;
  if (!userId) throw new Error("Usuário não autenticado.");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;

  const [runIdsResult, recentRunsResult, draftResult, configResult] = await Promise.all([
    db.from("analysis_runs").select("id").eq("owner_id", userId),
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

  if (runIdsResult.error) throw new Error("Não foi possível carregar suas análises.");
  if (recentRunsResult.error) throw new Error("Não foi possível carregar suas análises recentes.");
  if (draftResult.error) throw new Error("Não foi possível carregar o rascunho em andamento.");

  const runIds = (runIdsResult.data ?? []).map((row: DbRow) => String(row.id));
  const trackingResult = runIds.length
    ? await db
        .from("experimental_bet_tracking")
        .select("run_id,bet_status,stake_brl,profit_brl,result")
        .in("run_id", runIds)
    : { data: [], error: null };

  if (trackingResult.error) throw new Error("Não foi possível carregar suas pendências.");

  const tracking = (trackingResult.data ?? []) as DbRow[];
  const openCount = tracking.filter((row) => row.bet_status === "OPEN" && row.result === "PENDING").length;
  const proposedCount = tracking.filter((row) => row.bet_status === "PROPOSED").length;

  let availableBankroll: number | null = null;
  if (!configResult.error && configResult.data) {
    const initial = num(configResult.data.initial_bankroll);
    const settledProfit = tracking
      .filter((row) => row.bet_status === "SETTLED" || row.result !== "PENDING")
      .reduce((sum, row) => sum + num(row.profit_brl), 0);
    const locked = tracking
      .filter((row) => row.bet_status === "OPEN" && row.result === "PENDING")
      .reduce((sum, row) => sum + num(row.stake_brl), 0);
    availableBankroll = Math.max(0, initial + settledProfit - locked);
  }

  const recentRuns = (recentRunsResult.data ?? []) as DbRow[];
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
