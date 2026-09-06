import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, CircleDashed, TriangleAlert } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { runStep } from "@/lib/analysis.functions";
import { PIPELINE_STEPS, type PipelineStepKey } from "@/lib/pipeline.steps";

export const Route = createFileRoute("/run/$runId/processamento")({
  head: () => ({
    meta: [
      { title: "Processamento do pipeline · Bet Value Engine" },
      {
        name: "description",
        content:
          "Acompanhe em tempo real a resolução de partidas, coleta, higienização, features, probabilidades e gates.",
      },
      { property: "og:title", content: "Processamento do pipeline · Bet Value Engine" },
      {
        property: "og:description",
        content: "Progresso real do pipeline quantitativo pré-jogo, com falhas por fonte.",
      },
    ],
  }),
  component: ProcessingScreen,
});

type StepState = {
  status: "PENDING" | "RUNNING" | "DONE" | "ERROR";
  message: string | null;
  level: string | null;
};

function ProcessingScreen() {
  const { runId } = Route.useParams();
  const navigate = useNavigate();
  const execute = useServerFn(runStep);
  const started = useRef(false);
  const [states, setStates] = useState<Record<string, StepState>>(() =>
    Object.fromEntries(
      PIPELINE_STEPS.map((s) => [s.key, { status: "PENDING", message: null, level: null }]),
    ),
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      for (const step of PIPELINE_STEPS) {
        setStates((prev) => ({
          ...prev,
          [step.key]: { status: "RUNNING", message: null, level: null },
        }));
        try {
          const res = await execute({ data: { runId, step: step.key as PipelineStepKey } });
          setStates((prev) => ({
            ...prev,
            [step.key]: {
              status: "DONE",
              message: res.log?.message ?? null,
              level: res.log?.level ?? null,
            },
          }));
        } catch (error) {
          setStates((prev) => ({
            ...prev,
            [step.key]: {
              status: "ERROR",
              message: error instanceof Error ? error.message : "Falha na etapa",
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

  return (
    <AppShell stage="processamento">
      <p className="label-eyebrow">Etapa 2</p>
      <h1 className="mt-2 text-3xl font-bold">Processando a rodada</h1>
      <p className="mt-2 text-muted-foreground">
        Cada etapa reporta o resultado real do pipeline. Nenhum número é preenchido de forma
        fictícia.
      </p>

      <ol className="panel mt-8 divide-y divide-border">
        {PIPELINE_STEPS.map((step, i) => {
          const state = states[step.key]!;
          return (
            <li key={step.key} className="flex items-start gap-4 px-6 py-5">
              <span className="mt-0.5">
                {state.status === "DONE" ? (
                  <Check className="size-5 text-success" aria-hidden />
                ) : state.status === "RUNNING" ? (
                  <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
                ) : state.status === "ERROR" ? (
                  <TriangleAlert className="size-5 text-destructive" aria-hidden />
                ) : (
                  <CircleDashed className="size-5 text-muted-foreground" aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  <span className="num mr-2 text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {step.label}
                </p>
                {state.message && (
                  <p
                    className={`mt-1 text-sm ${
                      state.level === "WARN"
                        ? "text-warning"
                        : state.level === "ERROR"
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }`}
                  >
                    {state.message}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {failed && (
        <div className="mt-6 flex gap-3">
          <Button onClick={() => window.location.reload()}>Tentar novamente</Button>
          <Button variant="outline" onClick={() => navigate({ to: "/" })}>
            Enviar outro CSV
          </Button>
        </div>
      )}
    </AppShell>
  );
}
