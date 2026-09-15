import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { PushNotificationControl } from "@/components/PushNotificationControl";
import { SourceAudit } from "@/components/SourceAudit";
import { Button } from "@/components/ui/button";
import {
  enqueueAnalysis,
  getProcessingStatus,
  retryBackgroundAnalysis,
} from "@/lib/background-analysis.functions";
import { setAnalysisNotificationTarget } from "@/lib/push.browser";
import { PIPELINE_STEPS, type PipelineStepKey } from "@/lib/pipeline.steps";

export const Route = createFileRoute("/run/$runId/processamento")({
  head: () => ({ meta: [{ title: "Analisando jogos · Bet Value" }] }),
  component: ProcessingScreen,
});

const STEP_LABEL: Record<PipelineStepKey, string> = {
  RESOLVE: "Confirmando os jogos",
  COLLECT: "Buscando informações",
  CLEAN: "Organizando os dados",
  FEATURES: "Preparando os indicadores",
  PROBABILITY: "Calculando as chances",
  GATES: "Aplicando os filtros",
  MARKETS: "Selecionando os mercados",
  ODDS: "Conferindo as odds disponíveis",
};

const DONE_MESSAGE: Record<PipelineStepKey, string> = {
  RESOLVE: "Jogos confirmados",
  COLLECT: "Informações recebidas",
  CLEAN: "Dados organizados",
  FEATURES: "Indicadores preparados",
  PROBABILITY: "Chances calculadas",
  GATES: "Filtros aplicados",
  MARKETS: "Mercados avaliados",
  ODDS: "Odds conferidas",
};

function dateLabel(iso: string | null | undefined) {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function ProcessingScreen() {
  const { runId } = Route.useParams();
  const navigate = useNavigate();
  const load = useServerFn(getProcessingStatus);
  const enqueue = useServerFn(enqueueAnalysis);
  const retryJob = useServerFn(retryBackgroundAnalysis);

  const query = useQuery({
    queryKey: ["background-analysis", runId],
    queryFn: () => load({ data: { runId } }),
    refetchInterval: (state) => (state.state.data?.ready ? false : 1500),
  });

  useEffect(() => {
    void enqueue({ data: { runId } }).then(() => query.refetch()).catch(() => undefined);
    void setAnalysisNotificationTarget(runId);
    // This safety check runs once per analysis. The operation itself is idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enqueue, runId]);

  useEffect(() => {
    if (query.data?.ready) {
      navigate({ to: "/run/$runId/oportunidades", params: { runId }, replace: true });
    }
  }, [navigate, query.data?.ready, runId]);

  const completed = new Set<string>(query.data?.job?.completed_steps ?? []);
  const currentStep = (query.data?.job?.current_step ?? query.data?.run?.current_step ?? "RESOLVE") as PipelineStepKey;
  const jobStatus = query.data?.job?.status ?? "QUEUED";
  const failed = jobStatus === "ERROR";
  const doneCount = completed.size;
  const progress = Math.min(100, Math.round((doneCount / PIPELINE_STEPS.length) * 100));
  const logs = query.data?.logs ?? [];

  async function retry() {
    await retryJob({ data: { runId } });
    await query.refetch();
  }

  return (
    <AppShell stage="processamento">
      <div className="mx-auto max-w-2xl">
        <div className="mb-5">
          <p className="label-eyebrow">Análise em andamento</p>
          <h1 className="page-heading mt-1.5">Estamos analisando os jogos</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Pode fechar esta tela. O processamento continua sozinho e você recebe um aviso quando estiver pronto.
          </p>
        </div>

        <section className="panel overflow-hidden p-5 sm:p-6" aria-live="polite">
          {failed ? (
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10"><TriangleAlert className="size-5 text-destructive" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">A análise parou nesta etapa</h2>
                <p className="mt-1 text-sm text-muted-foreground">{query.data?.job?.last_error ?? "Não foi possível concluir o processamento."}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10"><Loader2 className="size-5 animate-spin text-primary" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Agora</p>
                <h2 className="mt-1 text-lg font-semibold">{STEP_LABEL[currentStep] ?? "Preparando a análise"}</h2>
                {query.data?.run && (
                  <p className="mt-1 text-sm text-muted-foreground">Rodada {dateLabel(query.data.run.target_date)} · {query.data.run.matches_total ?? 0} jogos</p>
                )}
              </div>
              <span className="num shrink-0 text-sm font-semibold text-primary">{progress}%</span>
            </div>
          )}

          <div className="mt-5 h-2 overflow-hidden rounded-full bg-secondary" aria-label={`${progress}% concluído`}>
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{doneCount} de {PIPELINE_STEPS.length} etapas concluídas</p>

          {failed && (
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Button className="min-h-11" onClick={() => void retry()}>Tentar novamente</Button>
              <Button className="min-h-11" variant="outline" onClick={() => navigate({ to: "/" })}>Voltar ao início</Button>
            </div>
          )}
        </section>

        {query.isError && (
          <div className="mt-4 rounded-xl border border-warning/25 bg-warning/8 p-4" role="alert">
            <p className="text-sm font-medium">Não conseguimos atualizar a tela agora.</p>
            <p className="mt-1 text-xs text-muted-foreground">A análise continua no servidor. Você pode tentar atualizar apenas o status.</p>
            <Button className="mt-3 min-h-11" variant="outline" onClick={() => void query.refetch()}>Atualizar status</Button>
          </div>
        )}

        <div className="mt-4"><PushNotificationControl /></div>

        <details className="mt-4 rounded-xl border border-border/60 bg-secondary/10">
          <summary className="touch-target flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium">
            Ver detalhes da preparação
            <span className="text-xs font-normal text-muted-foreground">{doneCount}/{PIPELINE_STEPS.length}</span>
          </summary>
          <ol className="divide-y divide-border/60 border-t border-border/60 px-4">
            {PIPELINE_STEPS.map((step) => {
              const isDone = completed.has(step.key);
              const isCurrent = currentStep === step.key && !failed;
              return (
                <li key={step.key} className="flex min-h-11 items-center gap-3 py-2 text-sm">
                  <CheckCircle2 className={`size-4 shrink-0 ${isDone ? "text-success" : isCurrent ? "text-primary" : "text-muted-foreground/45"}`} aria-hidden />
                  <span className={isDone || isCurrent ? "text-foreground" : "text-muted-foreground"}>{isDone ? DONE_MESSAGE[step.key] : STEP_LABEL[step.key]}</span>
                </li>
              );
            })}
          </ol>
        </details>

        <SourceAudit runId={runId} refreshKey={logs.length} />
      </div>
    </AppShell>
  );
}
