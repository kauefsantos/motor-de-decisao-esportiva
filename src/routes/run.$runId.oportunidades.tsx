import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { DecisionQueueGate } from "@/components/DecisionQueueGate";
import { SourceAudit } from "@/components/SourceAudit";

export const Route = createFileRoute("/run/$runId/oportunidades")({
  head: () => ({ meta: [{ title: "Conferir e escolher · Bet Value Engine" }] }),
  component: OpportunitiesScreen,
});

function OpportunitiesScreen() {
  const { runId } = Route.useParams();

  return (
    <AppShell stage="oportunidades">
      <div className="mx-auto max-w-6xl">
        <p className="label-eyebrow">Etapa 3 de 4 · conferir e escolher</p>
        <h1 className="page-heading mt-2">Conferir as odds e escolher</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          As chances já foram calculadas. Agora conferimos o preço real e mostramos somente as opções que ainda fazem sentido. Você pode escolher até 3 para esta rodada.
        </p>

        <div className="mt-4 rounded-xl border border-primary/15 bg-primary/[0.04] px-4 py-3 text-sm" data-testid="experimental-fun-mode-banner">
          <p className="font-medium text-foreground">Modo diversão · experimental ativo</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Estas sugestões usam o uncertainty-linear 40% para acompanhamento e entretenimento. A Stage 9 testa calibração em paralelo e não bloqueia esta análise. A certificação estatística e qualquer uso com stake real continuam separados.
          </p>
        </div>

        <DecisionQueueGate runId={runId} />
        <SourceAudit runId={runId} refreshKey={0} />
      </div>
    </AppShell>
  );
}
