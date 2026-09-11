import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { ExperimentalMarketsPilot } from "@/components/ExperimentalMarketsPilot";
import { SourceAudit } from "@/components/SourceAudit";

export const Route = createFileRoute("/run/$runId/oportunidades")({
  head: () => ({ meta: [{ title: "Conferir odds · Bet Value Engine" }] }),
  component: OpportunitiesScreen,
});

function OpportunitiesScreen() {
  const { runId } = Route.useParams();

  return (
    <AppShell stage="oportunidades">
      <div className="mx-auto max-w-6xl">
        <p className="label-eyebrow">Etapa 3</p>
        <h1 className="page-heading mt-2">Conferir odds</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          As chances já foram calculadas. O sistema tenta obter as odds da Bet365 automaticamente e mostra apenas o que ainda precisa ser conferido por você.
        </p>

        <ExperimentalMarketsPilot runId={runId} />
        <SourceAudit runId={runId} refreshKey={0} />
      </div>
    </AppShell>
  );
}
