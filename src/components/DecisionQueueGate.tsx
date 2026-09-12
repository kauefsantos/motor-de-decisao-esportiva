import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, TriangleAlert, X } from "lucide-react";

import { DecisionQueueFlow } from "@/components/DecisionQueueFlow";
import { Button } from "@/components/ui/button";
import { useDecisionQueueActions } from "@/hooks/useDecisionQueueActions";
import {
  DECISION_FAMILY_LABELS,
  formatDecisionDecimal,
  formatDecisionPercent,
  type DecisionQueueHistory,
} from "@/lib/application/decision-queue/view-model";
import { getDecisionQueueHistory } from "@/lib/decision-queue.functions";

export function DecisionQueueGate({ runId }: { runId: string }) {
  const loadHistory = useServerFn(getDecisionQueueHistory);
  const historyQuery = useQuery({
    queryKey: ["decision-queue-history", runId],
    queryFn: async () => (await loadHistory({ data: { runId } })).data as DecisionQueueHistory,
    staleTime: 0,
    retry: 1,
  });

  if (historyQuery.isLoading) {
    return (
      <section className="panel mt-4 flex items-center gap-2 p-5 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Recuperando suas escolhas…
      </section>
    );
  }

  if (historyQuery.isError || !historyQuery.data) {
    return (
      <section className="panel mt-4 border-destructive/30 p-5" role="alert">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div>
            <p className="font-medium">Não foi possível recuperar suas escolhas salvas</p>
            <p className="mt-1 text-sm text-muted-foreground">Nenhuma nova cotação será iniciada até conseguirmos confirmar o estado anterior.</p>
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

function PersistedDecisionQueue({ runId, initialHistory }: { runId: string; initialHistory: DecisionQueueHistory }) {
  const navigate = useNavigate();
  const loadHistory = useServerFn(getDecisionQueueHistory);
  const historyQuery = useQuery({
    queryKey: ["decision-queue-history", runId],
    queryFn: async () => (await loadHistory({ data: { runId } })).data as DecisionQueueHistory,
    initialData: initialHistory,
    staleTime: 0,
    retry: 1,
  });
  const actions = useDecisionQueueActions(runId, async () => {
    const result = await historyQuery.refetch();
    return { data: result.data };
  });

  const history = historyQuery.data;
  const rows = history.rows ?? [];
  const shown = rows.filter((row) => row.queue_state === "SHOWN");
  const accepted = rows.filter((row) => row.queue_state === "ACCEPTED");
  const acceptedCount = history.acceptedCount ?? accepted.length;
  const dailyLimit = history.dailySelectionLimit ?? 3;
  const exhausted = Boolean(history.exhausted);
  const canFinalize = !history.selectionFinalized && acceptedCount > 0 && (acceptedCount >= dailyLimit || exhausted);

  if (historyQuery.isError) {
    return (
      <section className="panel mt-4 border-destructive/30 p-5" role="alert">
        <p className="font-medium">Não foi possível atualizar suas escolhas</p>
        <p className="mt-1 text-sm text-muted-foreground">O que você já decidiu continua salvo. Tente novamente para atualizar a tela.</p>
        <Button className="mt-4" variant="outline" onClick={() => void actions.refresh()}>Tentar novamente</Button>
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
            <p className="mt-1 text-sm text-muted-foreground">A etapa foi recuperada sem refazer modelos ou buscar as odds novamente.</p>
            <Button className="mt-4" onClick={() => navigate({ to: "/run/$runId/resultado", params: { runId }, search: { mode: "experimental" } })}>Revisar e registrar</Button>
          </div>
        </div>
      </section>
    );
  }

  if (history.decisionQueueEvaluated && rows.length === 0) {
    return (
      <section className="panel mt-4 border-warning/25 p-5">
        <h2 className="font-semibold">Nenhuma opção passou por todos os critérios</h2>
        <p className="mt-1 text-sm text-muted-foreground">Esta rodada já foi avaliada. Atualizar ou reabrir a página não repete os modelos nem as cotações desta avaliação.</p>
        <p className="mt-2 text-xs text-muted-foreground">Nenhuma aposta artificial foi criada para preencher o limite.</p>
      </section>
    );
  }

  return (
    <section className="panel mt-4 overflow-hidden border-primary/20">
      <div className="border-b border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="label-eyebrow">Opções salvas</p>
            <h2 className="mt-1 text-lg font-semibold">Continue de onde parou</h2>
            <p className="mt-1 text-xs text-muted-foreground">Suas decisões foram recuperadas sem repetir a análise ou as cotações.</p>
          </div>
          <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">{acceptedCount}/{dailyLimit} escolhidas</span>
        </div>
      </div>

      {accepted.length > 0 && (
        <div className="border-b border-border/60 px-4 py-3 sm:px-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-success">Já escolhidas</p>
          <div className="mt-2 divide-y divide-border/60">
            {accepted.map((row) => (
              <div key={row.id} className="py-2 first:pt-0 last:pb-0">
                <p className="text-sm font-medium">{row.match_label}</p>
                <p className="text-xs text-muted-foreground">{row.market_label} · odd {formatDecisionDecimal(row.entry_odd)} · EV esperado {formatDecisionPercent(row.expected_value)}</p>
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
                  <p className="text-xs text-muted-foreground">#{row.rank_global} · {row.competition ?? "Competição"} · {DECISION_FAMILY_LABELS[row.market_family] ?? row.market_family}</p>
                  <h3 className="mt-1 text-base font-semibold">{row.match_label}</h3>
                  <p className="text-sm text-muted-foreground">{row.market_label}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Odd {formatDecisionDecimal(row.entry_odd)}</span>
                    <span>Chance {formatDecisionPercent(row.model_probability)}</span>
                    <span>EV esperado {formatDecisionPercent(row.expected_value)}</span>
                    <span>Vantagem {formatDecisionPercent(row.edge)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" className="min-h-11" disabled={actions.actionId !== null} onClick={() => void actions.declineRow(row.id)}>
                    <X className="mr-1 size-4" /> Recusar
                  </Button>
                  <Button className="min-h-11" disabled={actions.actionId !== null || acceptedCount >= dailyLimit} onClick={() => void actions.acceptRow(row.id)}>
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
          <p className="text-sm text-muted-foreground">Ainda há outras opções qualificadas.</p>
          <Button className="mt-3" variant="outline" onClick={() => void actions.nextBatch()}>Mostrar mais opções</Button>
        </div>
      )}

      {exhausted && acceptedCount === 0 && (
        <div className="p-5">
          <p className="font-medium">Nenhuma opção qualificada restou nesta rodada.</p>
          <p className="mt-1 text-sm text-muted-foreground">Nenhuma recomendação artificial foi criada para preencher o limite.</p>
        </div>
      )}

      {canFinalize && (
        <div className="border-t border-border p-4 sm:p-5">
          <Button className="min-h-12 w-full sm:w-auto" disabled={actions.finalizing} onClick={() => void actions.finalizeChoices()}>
            {actions.finalizing ? "Salvando escolhas…" : `REVISAR ${acceptedCount} ESCOLHA${acceptedCount === 1 ? "" : "S"}`}
          </Button>
        </div>
      )}
    </section>
  );
}
