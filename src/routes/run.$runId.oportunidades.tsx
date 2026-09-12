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

        <DecisionQueueGate runId={runId} />
        <SourceAudit runId={runId} refreshKey={0} />
      </div>
    </AppShell>
  );
}
