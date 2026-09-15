import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, CheckCircle2, Loader2, TriangleAlert, X } from "lucide-react";

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
      <section className="panel mt-5 flex items-center gap-3 p-5 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
        Carregando o resultado…
      </section>
    );
  }

  if (historyQuery.isError || !historyQuery.data) {
    return (
      <section className="panel mt-5 border-destructive/30 p-5" role="alert">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div>
            <p className="font-medium">Não foi possível carregar o resultado</p>
            <p className="mt-1 text-sm text-muted-foreground">Sua análise continua salva. Nenhuma nova cotação será feita até conseguirmos recuperar o estado anterior.</p>
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
      <section className="panel mt-5 border-destructive/30 p-5" role="alert">
        <p className="font-medium">Não foi possível atualizar o resultado</p>
        <p className="mt-1 text-sm text-muted-foreground">O que você já escolheu continua salvo. Tente novamente para atualizar a tela.</p>
        <Button className="mt-4" variant="outline" onClick={() => void actions.refresh()}>Tentar novamente</Button>
      </section>
    );
  }

  if (history.selectionFinalized) {
    return (
      <section className="panel mt-5 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success/10"><Check className="size-5 text-success" aria-hidden /></span>
          <div>
            <h2 className="text-lg font-semibold">Escolhas salvas</h2>
            <p className="mt-1 text-sm text-muted-foreground">Você pode continuar de onde parou, sem refazer modelos ou buscar as odds novamente.</p>
            <Button className="mt-4 min-h-11" onClick={() => navigate({ to: "/run/$runId/resultado", params: { runId }, search: { mode: "experimental" } })}>Revisar escolhas</Button>
          </div>
        </div>
      </section>
    );
  }

  if (history.decisionQueueEvaluated && rows.length === 0) {
    return (
      <section className="panel mt-5 overflow-hidden border-success/20">
        <div className="p-5 sm:p-7">
          <span className="flex size-12 items-center justify-center rounded-full bg-success/10"><CheckCircle2 className="size-6 text-success" aria-hidden /></span>
          <p className="label-eyebrow mt-4">Análise concluída</p>
          <h2 className="mt-1 text-xl font-semibold">Nenhuma oportunidade nesta rodada</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Isso não é uma falha. Os jogos foram analisados, mas nenhuma opção passou por todos os filtros de chance, odd e valor. O sistema prefere mostrar zero opções a sugerir uma aposta fraca.
          </p>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button asChild className="min-h-11"><Link to="/">Voltar ao início</Link></Button>
            <Button asChild variant="outline" className="min-h-11"><Link to="/analytics">Ver desempenho</Link></Button>
          </div>
        </div>
        <details className="border-t border-border/60 bg-secondary/10 px-5 sm:px-7">
          <summary className="touch-target flex min-h-12 cursor-pointer list-none items-center text-sm font-medium">Por que pode não aparecer nenhuma opção?</summary>
          <div className="pb-4 text-xs leading-relaxed text-muted-foreground">
            <p>Uma opção só aparece quando passa simultaneamente pelos filtros mínimos de probabilidade, odd, valor esperado e vantagem. O limite é de até 3 escolhas; não existe obrigação de preencher esse limite.</p>
            <p className="mt-2">Atualizar ou reabrir esta página não repete os modelos nem as cotações desta avaliação.</p>
          </div>
        </details>
      </section>
    );
  }

  return (
    <section className="mt-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-eyebrow">Opções encontradas</p>
          <h2 className="mt-1 text-lg font-semibold">Escolha apenas o que quiser acompanhar</h2>
          <p className="mt-1 text-sm text-muted-foreground">Você pode selecionar até {dailyLimit}. Não é necessário preencher o limite.</p>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">{acceptedCount}/{dailyLimit} escolhidas</span>
      </div>

      {accepted.length > 0 && (
        <div className="panel mb-3 p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-success">Selecionadas</p>
          <div className="mt-2 divide-y divide-border/60">
            {accepted.map((row) => (
              <div key={row.id} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-semibold">{row.match_label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{row.market_label} · odd {formatDecisionDecimal(row.entry_odd)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {shown.length > 0 && acceptedCount < dailyLimit && (
        <div className="grid gap-3">
          {shown.map((row) => (
            <article key={row.id} className="panel overflow-hidden p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">{row.competition ?? "Competição"} · {DECISION_FAMILY_LABELS[row.market_family] ?? row.market_family}</p>
                  <h3 className="mt-1 text-base font-semibold">{row.match_label}</h3>
                  <p className="mt-1 text-sm text-foreground/80">{row.market_label}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-lg bg-secondary/45 px-2.5 py-1.5 text-xs"><span className="text-muted-foreground">Odd</span> <strong className="num ml-1">{formatDecisionDecimal(row.entry_odd)}</strong></span>
                    <span className="rounded-lg bg-secondary/45 px-2.5 py-1.5 text-xs"><span className="text-muted-foreground">Chance calculada</span> <strong className="num ml-1">{formatDecisionPercent(row.model_probability)}</strong></span>
                  </div>
                  <details className="mt-3 text-xs text-muted-foreground">
                    <summary className="touch-target flex min-h-9 cursor-pointer list-none items-center font-medium text-foreground/80">Ver números da análise</summary>
                    <p>Valor esperado: {formatDecisionPercent(row.expected_value)} · Vantagem sobre a odd: {formatDecisionPercent(row.edge)}</p>
                  </details>
                </div>
                <div className="flex shrink-0 gap-2 sm:flex-col">
                  <Button className="min-h-11 flex-1 sm:w-28" disabled={actions.actionId !== null || acceptedCount >= dailyLimit} onClick={() => void actions.acceptRow(row.id)}>
                    <Check className="mr-1 size-4" /> Escolher
                  </Button>
                  <Button variant="ghost" className="min-h-11 flex-1 text-muted-foreground sm:w-28" disabled={actions.actionId !== null} onClick={() => void actions.declineRow(row.id)}>
                    <X className="mr-1 size-4" /> Descartar
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {shown.length === 0 && !exhausted && acceptedCount < dailyLimit && (
        <div className="panel p-5">
          <p className="text-sm text-muted-foreground">Há outras opções qualificadas que ainda não foram mostradas.</p>
          <Button className="mt-3" variant="outline" onClick={() => void actions.nextBatch()}>Ver próximas opções</Button>
        </div>
      )}

      {exhausted && acceptedCount === 0 && (
        <div className="panel p-5">
          <h3 className="font-semibold">Não restaram opções qualificadas</h3>
          <p className="mt-1 text-sm text-muted-foreground">O sistema não cria recomendações artificiais só para preencher o limite.</p>
        </div>
      )}

      {canFinalize && (
        <div className="sticky bottom-[5.2rem] mt-4 rounded-2xl border border-primary/20 bg-background/95 p-3 shadow-lg backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
          <Button className="min-h-12 w-full sm:w-auto" disabled={actions.finalizing} onClick={() => void actions.finalizeChoices()}>
            {actions.finalizing ? "Salvando…" : `Continuar com ${acceptedCount} escolha${acceptedCount === 1 ? "" : "s"}`}
          </Button>
        </div>
      )}
    </section>
  );
}
