import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { DecisionQueueFlow } from "@/components/DecisionQueueFlow";
import { Button } from "@/components/ui/button";
import {
  acceptDecisionOpportunity,
  declineDecisionOpportunity,
  finalizeDecisionSelection,
  getDecisionQueueHistory,
  getNextDecisionBatch,
} from "@/lib/decision-queue.functions";

const FAMILY_LABELS: Record<string, string> = {
  CORNERS: "Escanteios",
  CARDS: "Cartões",
  GOALS: "Gols",
  "1X2": "Resultado",
  DOUBLE_CHANCE: "Dupla chance",
};

const pct = (value: unknown, digits = 1) =>
  value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(digits)}%`;
const dec = (value: unknown) =>
  value === null || value === undefined ? "—" : Number(value).toFixed(2);

type QueueRow = {
  id: string;
  queue_state: "AVAILABLE" | "SHOWN" | "ACCEPTED" | "DECLINED";
  rank_global: number;
  match_label: string;
  competition: string | null;
  market_family: string;
  market_label: string;
  model_probability: number | string;
  entry_odd: number | string;
  edge: number | string | null;
  expected_value: number | string | null;
};

type QueueHistory = {
  rows: QueueRow[];
  acceptedCount: number;
  exhausted: boolean;
  selectionFinalized: boolean;
  decisionQueueEvaluated: boolean;
  canProceedToStake: boolean;
  dailySelectionLimit: number;
};

export function DecisionQueueGate({ runId }: { runId: string }) {
  const loadHistory = useServerFn(getDecisionQueueHistory);
  const historyQuery = useQuery({
    queryKey: ["decision-queue-history", runId],
    queryFn: async () => (await loadHistory({ data: { runId } })).data as QueueHistory,
    staleTime: 0,
    retry: 1,
  });

  if (historyQuery.isLoading) {
    return (
      <section className="panel mt-4 flex items-center gap-2 p-5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Recuperando o estado da decisão…
      </section>
    );
  }

  if (historyQuery.isError || !historyQuery.data) {
    return (
      <section className="panel mt-4 border-destructive/30 p-5" role="alert">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div>
            <p className="font-medium">Não foi possível recuperar a fila salva</p>
            <p className="mt-1 text-sm text-muted-foreground">Nenhuma preparação ou cotação foi repetida enquanto o estado anterior não pôde ser confirmado.</p>
            <Button className="mt-4" variant="outline" onClick={() => void historyQuery.refetch()}>Tentar novamente</Button>
          </div>
        </div>
      </section>
    );
  }

  const hasPersistedDecisionState = historyQuery.data.decisionQueueEvaluated
    || historyQuery.data.rows.length > 0
    || historyQuery.data.selectionFinalized;
  if (!hasPersistedDecisionState) {
    return <DecisionQueueFlow runId={runId} />;
  }

  return <PersistedDecisionQueue runId={runId} initialHistory={historyQuery.data} />;
}

function PersistedDecisionQueue({ runId, initialHistory }: { runId: string; initialHistory: QueueHistory }) {
  const navigate = useNavigate();
  const loadHistory = useServerFn(getDecisionQueueHistory);
  const loadNextBatch = useServerFn(getNextDecisionBatch);
  const accept = useServerFn(acceptDecisionOpportunity);
  const decline = useServerFn(declineDecisionOpportunity);
  const finalize = useServerFn(finalizeDecisionSelection);
  const [actionId, setActionId] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  const historyQuery = useQuery({
    queryKey: ["decision-queue-history", runId],
    queryFn: async () => (await loadHistory({ data: { runId } })).data as QueueHistory,
    initialData: initialHistory,
    staleTime: 0,
    retry: 1,
  });

  const history = historyQuery.data;
  const rows = history.rows ?? [];
  const shown = rows.filter((row) => row.queue_state === "SHOWN");
  const accepted = rows.filter((row) => row.queue_state === "ACCEPTED");
  const acceptedCount = history.acceptedCount ?? accepted.length;
  const dailyLimit = history.dailySelectionLimit ?? 3;
  const exhausted = Boolean(history.exhausted);
  const canFinalize = !history.selectionFinalized && acceptedCount > 0 && (acceptedCount >= dailyLimit || exhausted);

  async function refresh() {
    await historyQuery.refetch();
  }

  async function nextBatch() {
    try {
      await loadNextBatch({ data: { runId } });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível carregar o próximo lote.");
    }
  }

  async function acceptRow(queueId: string) {
    setActionId(queueId);
    try {
      await accept({ data: { queueId } });
      await refresh();
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
      const refreshed = await historyQuery.refetch();
      const fresh = refreshed.data;
      const freshRows = fresh?.rows ?? [];
      const stillShown = freshRows.some((row) => row.queue_state === "SHOWN");
      if (!stillShown && !fresh?.exhausted && (fresh?.acceptedCount ?? 0) < (fresh?.dailySelectionLimit ?? 3)) {
        await loadNextBatch({ data: { runId } });
        await refresh();
      }
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
      toast.error(error instanceof Error ? error.message : "Não foi possível confirmar as escolhas.");
      setFinalizing(false);
    }
  }

  if (historyQuery.isError) {
    return (
      <section className="panel mt-4 border-destructive/30 p-5" role="alert">
        <p className="font-medium">A fila salva não pôde ser atualizada</p>
        <p className="mt-1 text-sm text-muted-foreground">O estado continua no servidor e nenhuma preparação foi executada novamente.</p>
        <Button className="mt-4" variant="outline" onClick={() => void refresh()}>Tentar novamente</Button>
      </section>
    );
  }

  if (history.selectionFinalized) {
    return (
      <section className="panel mt-4 p-5">
        <div className="flex items-start gap-3">
          <Check className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <div>
            <h2 className="font-semibold">Escolhas já confirmadas</h2>
            <p className="mt-1 text-sm text-muted-foreground">A decisão foi recuperada do servidor sem recalcular modelos nem repetir cotações.</p>
            <Button className="mt-4" onClick={() => navigate({ to: "/run/$runId/resultado", params: { runId }, search: { mode: "experimental" } })}>Ver sugestões</Button>
          </div>
        </div>
      </section>
    );
  }

  if (history.decisionQueueEvaluated && rows.length === 0) {
    return (
      <section className="panel mt-4 border-warning/25 p-5">
        <h2 className="font-semibold">Nenhuma opção passou por todos os critérios</h2>
        <p className="mt-1 text-sm text-muted-foreground">Esta rodada já foi avaliada e o resultado foi recuperado do servidor. Nenhuma aposta artificial foi criada.</p>
        <p className="mt-2 text-xs text-muted-foreground">Reabrir ou atualizar esta página não repete modelos nem cotações externas para esta avaliação.</p>
      </section>
    );
  }

  return (
    <section className="panel mt-4 overflow-hidden border-primary/20">
      <div className="border-b border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="label-eyebrow">Fila recuperada</p>
            <h2 className="mt-1 text-lg font-semibold">Continue de onde parou</h2>
            <p className="mt-1 text-xs text-muted-foreground">O estado veio do servidor. Modelos, integrações externas e cotações não foram executados novamente.</p>
          </div>
          <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">{acceptedCount}/{dailyLimit} escolhidas</span>
        </div>
      </div>

      {accepted.length > 0 && (
        <div className="border-b border-border bg-success/[0.04] p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-success">Já escolhidas</p>
          <div className="mt-2 grid gap-2">
            {accepted.map((row) => (
              <div key={row.id} className="rounded-lg border border-success/15 bg-background/60 p-3">
                <p className="text-sm font-medium">{row.match_label}</p>
                <p className="text-xs text-muted-foreground">{row.market_label} · odd {dec(row.entry_odd)} · EV {pct(row.expected_value)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {shown.length > 0 && acceptedCount < dailyLimit && (
        <div className="divide-y divide-border/70">
          {shown.map((row) => (
            <article key={row.id} className="p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">#{row.rank_global} · {row.competition ?? "Competição"} · {FAMILY_LABELS[row.market_family] ?? row.market_family}</p>
                  <h3 className="mt-1 text-base font-semibold">{row.match_label}</h3>
                  <p className="text-sm text-muted-foreground">{row.market_label}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Odd {dec(row.entry_odd)}</span>
                    <span>Chance {pct(row.model_probability)}</span>
                    <span>EV {pct(row.expected_value)}</span>
                    <span>Vantagem {pct(row.edge)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" className="min-h-11" disabled={actionId === row.id} onClick={() => void declineRow(row.id)}>
                    <X className="mr-1 size-4" /> Recusar
                  </Button>
                  <Button className="min-h-11" disabled={actionId === row.id || acceptedCount >= dailyLimit} onClick={() => void acceptRow(row.id)}>
                    <Check className="mr-1 size-4" /> Escolher
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {shown.length === 0 && !exhausted && acceptedCount < dailyLimit && (
        <div className="p-5">
          <p className="text-sm text-muted-foreground">O lote anterior terminou e ainda há opções qualificadas.</p>
          <Button className="mt-3" variant="outline" onClick={() => void nextBatch()}>Mostrar próximo lote</Button>
        </div>
      )}

      {exhausted && acceptedCount === 0 && (
        <div className="p-5">
          <p className="font-medium">A fila terminou sem escolha.</p>
          <p className="mt-1 text-sm text-muted-foreground">Nenhuma recomendação artificial foi criada para preencher o limite.</p>
        </div>
      )}

      {canFinalize && (
        <div className="border-t border-border p-4 sm:p-5">
          <Button className="min-h-12 w-full sm:w-auto" disabled={finalizing} onClick={() => void finalizeChoices()}>
            {finalizing ? "Confirmando…" : `CONFIRMAR ${acceptedCount} ESCOLHA${acceptedCount === 1 ? "" : "S"}`}
          </Button>
        </div>
      )}
    </section>
  );
}
