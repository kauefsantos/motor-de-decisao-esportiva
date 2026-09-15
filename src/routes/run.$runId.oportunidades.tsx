import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { DecisionQueueGate } from "@/components/DecisionQueueGate";
import { SourceAudit } from "@/components/SourceAudit";

export const Route = createFileRoute("/run/$runId/oportunidades")({
  head: () => ({ meta: [{ title: "Resultado da análise · Bet Value" }] }),
  component: OpportunitiesScreen,
});

function OpportunitiesScreen() {
  const { runId } = Route.useParams();

  return (
    <AppShell stage="oportunidades">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="label-eyebrow">Análise concluída</p>
            <h1 className="page-heading mt-1.5">Resultado da análise</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Agora só aparecem as opções que passaram pelos filtros. Se nenhuma aparecer, a análise terminou normalmente e o sistema decidiu não forçar uma aposta.
            </p>
          </div>
          <span className="inline-flex w-fit shrink-0 rounded-full border border-primary/20 bg-primary/[0.06] px-3 py-1.5 text-xs font-medium text-primary" data-testid="experimental-fun-mode-banner">
            Modo diversão · experimental ativo
          </span>
        </div>

        <DecisionQueueGate runId={runId} />

        <details className="mt-4 rounded-xl border border-border/60 bg-secondary/10 px-4">
          <summary className="touch-target flex min-h-12 cursor-pointer list-none items-center text-sm font-medium">Como esta análise funciona?</summary>
          <div className="border-t border-border/60 py-4 text-xs leading-relaxed text-muted-foreground">
            <p>O sistema cruza a chance calculada com a odd disponível e elimina opções sem margem suficiente. O limite é de até 3 escolhas, mas zero também é um resultado válido.</p>
            <p className="mt-2">O modelo experimental e a Stage 9 continuam separados da validação para uso com dinheiro real. Esta tela serve para acompanhamento e entretenimento.</p>
          </div>
        </details>

        <SourceAudit runId={runId} refreshKey={0} />
      </div>
    </AppShell>
  );
}
