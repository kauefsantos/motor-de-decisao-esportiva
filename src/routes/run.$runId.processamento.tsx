import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, CircleDashed, TriangleAlert } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { SourceAudit } from "@/components/SourceAudit";
import { Button } from "@/components/ui/button";
import { runStep } from "@/lib/analysis.functions";
import { PIPELINE_STEPS, type PipelineStepKey } from "@/lib/pipeline.steps";

export const Route = createFileRoute("/run/$runId/processamento")({
  head: () => ({
    meta: [{ title: "Preparando análise · Bet Value Engine" }],
  }),
  component: ProcessingScreen,
});

type StepState = {
  status: "PENDING" | "RUNNING" | "DONE" | "ERROR";
  message: string | null;
  level: string | null;
};

const DONE_MESSAGE: Record<PipelineStepKey, string> = {
  RESOLVE: "Jogos identificados.",
  COLLECT: "Informações recebidas.",
  CLEAN: "Informações organizadas.",
  FEATURES: "Resumo preparado.",
  PROBABILITY: "Chances calculadas.",
  GATES: "Opções filtradas.",
  MARKETS: "Lista pronta.",
};

function friendlyStepMessage(step: PipelineStepKey, level: string | null | undefined) {
  return level === "WARN"
    ? `${DONE_MESSAGE[step]} Algumas informações ficaram incompletas.`
    : DONE_MESSAGE[step];
}

function ProcessingScreen() {
  const { runId } = Route.useParams();
  const navigate = useNavigate();
  const execute = useServerFn(runStep);
  const started = useRef(false);
  const [states, setStates] = useState<Record<string, StepState>>(() =>
    Object.fromEntries(PIPELINE_STEPS.map((s) => [s.key, { status: "PENDING", message: null, level: null }])),
  );
  const [failed, setFailed] = useState(false);
  const [auditKey, setAuditKey] = useState(0);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      for (const step of PIPELINE_STEPS) {
        setStates((prev) => ({ ...prev, [step.key]: { status: "RUNNING", message: null, level: null } }));
        try {
          const res = await execute({ data: { runId, step: step.key as PipelineStepKey } });
          setStates((prev) => ({
            ...prev,
            [step.key]: {
              status: "DONE",
              message: friendlyStepMessage(step.key, res.log?.level),
              level: res.log?.level ?? null,
            },
          }));
          setAuditKey((k) => k + 1);
        } catch {
          setStates((prev) => ({
            ...prev,
            [step.key]: {
              status: "ERROR",
              message: "Não foi possível concluir esta etapa. Tente novamente.",
              level: "ERROR",
            },
          }));
          setFailed(true);
          return;
        }
      }
      navigate({ to: "/run/$runId/oportunidades", params: { runId } });
    })();
  }, [execute, navigate, runId]);

  const doneCount = Object.values(states).filter((state) => state.status === "DONE").length;

  return (
    <AppShell stage="processamento">
      <div className="mx-auto max-w-4xl">
        <p className="label-eyebrow">Etapa 2</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-heading">Preparando sua análise</h1>
            <p className="mt-2 text-sm text-muted-foreground">Encontrando jogos, reunindo informações e calculando as chances.</p>
          </div>
          <span className="num rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{doneCount}/{PIPELINE_STEPS.length}</span>
        </div>

        <ol className="panel mt-6 divide-y divide-border overflow-hidden">
          {PIPELINE_STEPS.map((step, i) => {
            const state = states[step.key]!;
            const showMessage = state.status === "RUNNING" || state.status === "ERROR" || state.level === "WARN";
            return (
              <li
                key={step.key}
                className={`flex items-start gap-3 px-4 py-3 transition-colors sm:px-5 ${
                  state.status === "RUNNING" ? "bg-primary/8" : state.status === "ERROR" ? "bg-destructive/8" : ""
                }`}
              >
                <span className="mt-0.5 shrink-0">
                  {state.status === "DONE" ? (
                    <Check className="size-4 text-success" aria-hidden />
                  ) : state.status === "RUNNING" ? (
                    <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                  ) : state.status === "ERROR" ? (
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
                  {showMessage && state.message && (
                    <p className={`mt-1 text-xs ${state.level === "WARN" ? "text-warning" : state.status === "ERROR" ? "text-destructive" : "text-muted-foreground"}`}>
                      {state.message}
                    </p>
                  )}
                </div>
                {state.status === "DONE" && !showMessage && <span className="hidden text-xs text-muted-foreground sm:inline">Concluído</span>}
              </li>
            );
          })}
        </ol>

        <SourceAudit runId={runId} refreshKey={auditKey} />

        {failed && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button className="min-h-11" onClick={() => window.location.reload()}>Tentar de novo</Button>
            <Button className="min-h-11" variant="outline" onClick={() => navigate({ to: "/" })}>Enviar outro CSV</Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
