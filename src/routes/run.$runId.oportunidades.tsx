import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { DecisionQueueGate } from "@/components/DecisionQueueGate";
import { SourceAudit } from "@/components/SourceAudit";

export const Route = createFileRoute("/run/$runId/oportunidades")({
  head: () => ({ meta: [{ title: "Conferir odds e escolher · Bet Value Engine" }] }),
  component: OpportunitiesScreen,
});

function OpportunitiesScreen() {
  const { runId } = Route.useParams();

  return (
    <AppShell stage="oportunidades">
      <div className="mx-auto max-w-6xl">
        <p className="label-eyebrow">Etapa 3</p>
        <h1 className="page-heading mt-2">Conferir odds e decidir</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          As chances já foram calculadas. O sistema busca a odd real quando possível, avalia valor no servidor e abre as opções qualificadas em lotes de até 10. Você pode escolher no máximo 3 por data, em qualquer dia da semana.
        </p>

        <DecisionQueueGate runId={runId} />
        <SourceAudit runId={runId} refreshKey={0} />
      </div>
    </AppShell>
  );
}
