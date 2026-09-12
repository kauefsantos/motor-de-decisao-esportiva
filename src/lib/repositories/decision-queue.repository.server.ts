import type { AdminDb, RuntimeDatabase } from "../admin-db";
import { callRuntimeRpc } from "./runtime-rpc.server";

export type DecisionQueueRow = RuntimeDatabase["public"]["Tables"]["decision_opportunity_queue"]["Row"];

type OwnedDecisionRun = {
  id: string;
  target_date: string | null;
  selection_finalized_at: string | null;
};

type DeclineResult = {
  declined: boolean;
  exhausted: boolean;
  accepted_count: number;
};

type AcceptResult = {
  accepted: boolean;
  accepted_count: number;
  ready_for_stake: boolean;
};

type FinalizeResult = {
  finalized: boolean;
  accepted_count: number;
};

export async function findOwnedDecisionRun(
  db: AdminDb,
  runId: string,
  userId: string,
): Promise<OwnedDecisionRun | null> {
  const { data, error } = await db
    .from("analysis_runs")
    .select("id,target_date,selection_finalized_at")
    .eq("id", runId)
    .eq("owner_id", userId)
    .single();
  if (error || !data) return null;
  return data;
}

export async function replaceDecisionQueue(
  db: AdminDb,
  input: { runId: string; ownerId: string; rows: Record<string, unknown>[] },
) {
  return callRuntimeRpc<number>(db, "replace_decision_queue_atomic", {
    p_run_id: input.runId,
    p_owner_id: input.ownerId,
    p_rows: input.rows,
  });
}

export async function nextDecisionBatch(
  db: AdminDb,
  input: { runId: string; ownerId: string; limit?: number },
) {
  return callRuntimeRpc<DecisionQueueRow[]>(db, "next_decision_batch_atomic", {
    p_run_id: input.runId,
    p_owner_id: input.ownerId,
    p_limit: input.limit ?? 10,
  });
}

export async function declineDecisionQueueItem(
  db: AdminDb,
  input: { queueId: string; ownerId: string },
) {
  return callRuntimeRpc<DeclineResult[] | DeclineResult>(db, "decline_decision_opportunity_atomic", {
    p_queue_id: input.queueId,
    p_owner_id: input.ownerId,
  });
}

export async function acceptDecisionQueueItem(
  db: AdminDb,
  input: { queueId: string; ownerId: string },
) {
  return callRuntimeRpc<AcceptResult[] | AcceptResult>(db, "accept_decision_opportunity_atomic", {
    p_queue_id: input.queueId,
    p_owner_id: input.ownerId,
  });
}

export async function finalizeDecisionQueueSelection(
  db: AdminDb,
  input: { runId: string; ownerId: string },
) {
  return callRuntimeRpc<FinalizeResult[] | FinalizeResult>(db, "finalize_decision_selection_atomic", {
    p_run_id: input.runId,
    p_owner_id: input.ownerId,
  });
}
