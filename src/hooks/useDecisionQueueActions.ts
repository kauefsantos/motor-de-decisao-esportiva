import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import {
  acceptDecisionOpportunity,
  declineDecisionOpportunity,
  finalizeDecisionSelection,
  getNextDecisionBatch,
} from "@/lib/decision-queue.functions";
import type { DecisionQueueHistory } from "@/lib/application/decision-queue/view-model";

type RefetchHistory = () => Promise<{ data?: DecisionQueueHistory }>;

export function useDecisionQueueActions(runId: string, refetchHistory: RefetchHistory) {
  const navigate = useNavigate();
  const loadNextBatch = useServerFn(getNextDecisionBatch);
  const accept = useServerFn(acceptDecisionOpportunity);
  const decline = useServerFn(declineDecisionOpportunity);
  const finalize = useServerFn(finalizeDecisionSelection);
  const [actionId, setActionId] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  async function refresh() {
    return refetchHistory();
  }

  async function nextBatch() {
    try {
      await loadNextBatch({ data: { runId } });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível mostrar mais opções.");
    }
  }

  async function acceptRow(queueId: string) {
    setActionId(queueId);
    try {
      await accept({ data: { queueId } });
      await refresh();
      toast.success("Opção escolhida e salva.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível escolher esta opção.");
    } finally {
      setActionId(null);
    }
  }

  async function declineRow(queueId: string) {
    setActionId(queueId);
    try {
      await decline({ data: { queueId } });
      const refreshed = await refresh();
      const fresh = refreshed.data;
      const freshRows = fresh?.rows ?? [];
      const stillShown = freshRows.some((row) => row.queue_state === "SHOWN");
      if (!stillShown && !fresh?.exhausted && (fresh?.acceptedCount ?? 0) < (fresh?.dailySelectionLimit ?? 3)) {
        await loadNextBatch({ data: { runId } });
        await refresh();
      }
      toast.success("Opção recusada. Sua decisão foi salva.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível recusar esta opção.");
    } finally {
      setActionId(null);
    }
  }

  async function finalizeChoices() {
    setFinalizing(true);
    try {
      await finalize({ data: { runId } });
      await refresh();
      navigate({ to: "/run/$runId/resultado", params: { runId }, search: { mode: "experimental" } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível confirmar suas escolhas.");
      setFinalizing(false);
    }
  }

  return {
    actionId,
    finalizing,
    refresh,
    nextBatch,
    acceptRow,
    declineRow,
    finalizeChoices,
  };
}
