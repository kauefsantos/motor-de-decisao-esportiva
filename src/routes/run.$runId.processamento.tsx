import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { Check, Loader2, CircleDashed, TriangleAlert } from "lucide-react";

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
  head: () => ({
    meta: [{ title: "Preparando análise · Bet Value Engine" }],
  }),
  component: ProcessingScreen,
});

const DONE_MESSAGE: Record<PipelineStepKey, string> = {
  RESOLVE: "Jogos identificados.",
  COLLECT: "Informações recebidas.",
  CLEAN: "Informações organizadas.",
  FEATURES: "Resumo preparado.",
  PROBABILITY: "Chances calculadas.",
  GATES: "Opções filtradas.",
  MARKETS: "Lista pronta.",
};

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
    // Safety net for direct/reloaded visits; enqueue is idempotent.
    void enqueue({ data: { runId } }).then(() => query.refetch()).catch(() => undefined);
    void setAnalysisNotificationTarget(runId);
    // query.refetch is intentionally not a dependency: this should run once per run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enqueue, runId]);

  useEffect(() => {
    if (query.data?.ready) {
      navigate({ to: "/run/$runId/oportunidades", params: { runId }, replace: true });
    }
  }, [navigate, query.data?.ready, runId]);

  const completed = new Set<string>(query.data?.job?.completed_steps ?? []);
  const currentStep = query.data?.job?.current_step ?? query.data?.run?.current_step ?? null;
  const jobStatus = query.data?.job?.status ?? "QUEUED";
  const failed = jobStatus === "ERROR";
  const doneCount = completed.size;
  const logs = query.data?.logs ?? [];

  function lastLog(step: string) {
    return [...logs].reverse().find((log) => log.step === step);
  }

  async function retry() {
    await retryJob({ data: { runId } });
    await query.refetch();
  }

  return (
    <AppShell stage="processamento">
      <div className="mx-auto max-w-4xl">
        <p className="label-eyebrow">Etapa 2</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-heading">Preparando sua análise</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              O servidor continua trabalhando mesmo se você sair do app ou bloquear o iPhone.
            </p>
          </div>
          <span className="num rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
            {doneCount}/{PIPELINE_STEPS.length}
          </span>
        </div>

        <PushNotificationControl />

        {query.isError && (
          <div className="panel mt-4 border-destructive/30 p-4" role="alert">
            <p className="text-sm font-medium">Não foi possível atualizar o andamento agora.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              A análise pode continuar no servidor. Tente atualizar o status.
            </p>
            <Button className="mt-3 min-h-11" variant="outline" onClick={() => void query.refetch()}>
              Atualizar status
            </Button>
          </div>
        )}

        <ol className="panel mt-6 divide-y divide-border overflow-hidden">
          {PIPELINE_STEPS.map((step, i) => {
            const isDone = completed.has(step.key);
            const isRunning = !isDone && !failed && jobStatus === "RUNNING" && currentStep === step.key;
            const isFailed = failed && currentStep === step.key;
            const state = isDone ? "DONE" : isRunning ? "RUNNING" : isFailed ? "ERROR" : "PENDING";
            const log = lastLog(step.key);
            const showWarn = isDone && log?.level === "WARN";
            const message =
              state === "DONE"
                ? showWarn
                  ? `${DONE_MESSAGE[step.key]} Algumas informações ficaram incompletas.`
                  : DONE_MESSAGE[step.key]
                : state === "RUNNING"
                  ? "Processando no servidor…"
                  : state === "ERROR"
                    ? query.data?.job?.last_error ?? "Não foi possível concluir esta etapa."
                    : null;

            return (
              <li
                key={step.key}
                className={`flex items-start gap-3 px-4 py-3 transition-colors sm:px-5 ${
                  state === "RUNNING" ? "bg-primary/8" : state === "ERROR" ? "bg-destructive/8" : ""
                }`}
              >
                <span className="mt-0.5 shrink-0">
                  {state === "DONE" ? (
                    <Check className="size-4 text-success" aria-hidden />
                  ) : state === "RUNNING" ? (
                    <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                  ) : state === "ERROR" ? (
                    <TriangleAlert className="size-4 text-destructive" aria-hidden />
                  ) : (
                    <CircleDashed className="size-4 text-muted-foreground" aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    <span className="num mr-2 text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                    {step.label}
                  </p>
                  {message && (
                    <p className={`mt-1 text-xs ${showWarn ? "text-warning" : state === "ERROR" ? "text-destructive" : "text-muted-foreground"}`}>
                      {message}
                    </p>
                  )}
                </div>
                {state === "DONE" && !showWarn && <span className="hidden text-xs text-muted-foreground sm:inline">Concluído</span>}
              </li>
            );
          })}
        </ol>

        <SourceAudit runId={runId} refreshKey={logs.length} />

        {failed && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button className="min-h-11" onClick={() => void retry()}>Tentar de novo</Button>
            <Button className="min-h-11" variant="outline" onClick={() => navigate({ to: "/" })}>Enviar outro CSV</Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
