import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Info, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { ExperimentalMarketsPilot } from "@/components/ExperimentalMarketsPilot";
import { SourceAudit } from "@/components/SourceAudit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getRun, analyzeOdds } from "@/lib/analysis.functions";

export const Route = createFileRoute("/run/$runId/oportunidades")({
  head: () => ({ meta: [{ title: "Opções para conferir · Bet Value Engine" }] }),
  component: OpportunitiesScreen,
});

type Candidate = Awaited<ReturnType<typeof getRun>>["candidates"][number];

function simpleStatus(status: string | null | undefined) {
  const labels: Record<string, string> = {
    READY: "Pronto para análise",
    VALID: "Dados suficientes",
    OK: "Tudo certo",
    MODEL_NOT_PRODUCTION_VALIDATED: "Ainda em fase de teste",
    DATA_DEFINITION_MISMATCH: "Os dados disponíveis não combinam com esta opção",
    INSUFFICIENT_DATA: "Faltam dados suficientes",
    REFORECAST_REQUIRED: "A linha mudou e precisa ser recalculada",
  };
  return status ? labels[status] ?? "Em verificação" : "—";
}

function simpleBlockedReason(reason: string | null | undefined) {
  const labels: Record<string, string> = {
    MODEL_NOT_PRODUCTION_VALIDATED: "Esta opção ainda está em fase de teste.",
    DATA_DEFINITION_MISMATCH: "Os dados encontrados não são compatíveis com esta opção.",
    INSUFFICIENT_DATA: "Não há dados suficientes para mostrar esta opção com segurança.",
    REFORECAST_REQUIRED: "A linha disponível mudou e precisa ser recalculada.",
  };
  return reason ? labels[reason] ?? "Esta opção não atingiu os critérios mínimos da análise." : "Esta opção não atingiu os critérios mínimos da análise.";
}

const pct = (value: number | string | null) =>
  value === null ? "—" : `${(Number(value) * 100).toFixed(1)}%`;

function CandidateDetails({ candidate }: { candidate: Candidate }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
      <div className="metric-tile p-3"><span className="text-muted-foreground">Chance para decidir</span><strong className="num mt-1 block text-foreground">{pct(candidate.p_cons)}</strong></div>
      <div className="metric-tile p-3"><span className="text-muted-foreground">Odd de referência</span><strong className="num mt-1 block text-foreground">{candidate.fair_odd_info ? Number(candidate.fair_odd_info).toFixed(2) : "—"}</strong></div>
      <div className="metric-tile p-3"><span className="text-muted-foreground">Segurança</span><strong className="num mt-1 block text-foreground">{pct(candidate.confidence_score)}</strong></div>
      <div className="metric-tile p-3"><span className="text-muted-foreground">Qualidade dos dados</span><strong className="num mt-1 block text-foreground">{pct(candidate.data_quality_score)}</strong></div>
      <div className="metric-tile p-3"><span className="text-muted-foreground">Variação possível</span><strong className="num mt-1 block text-foreground">{pct(candidate.uncertainty)}</strong></div>
      <div className="metric-tile p-3"><span className="text-muted-foreground">Situação</span><strong className="mt-1 block text-foreground">{simpleStatus(candidate.model_status)}</strong></div>
      {candidate.reason_short && <p className="col-span-2 text-muted-foreground sm:col-span-3">{candidate.reason_short}</p>}
    </div>
  );
}

function OpportunitiesScreen() {
  const { runId } = Route.useParams();
  const navigate = useNavigate();
  const fetchRun = useServerFn(getRun);
  const analyze = useServerFn(analyzeOdds);
  const [odds, setOdds] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => fetchRun({ data: { runId } }),
  });

  const matchLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const match of data?.matches ?? []) {
      map.set(
        match.id,
        `${match.home_team && match.away_team ? `${match.home_team} x ${match.away_team}` : match.raw_partida}${match.competition ? ` · ${match.competition}` : ""}`,
      );
    }
    return map;
  }, [data]);

  const published = (data?.candidates ?? []).filter((candidate) => candidate.published);
  const blocked = (data?.candidates ?? []).filter((candidate) => !candidate.published);

  async function analisar() {
    const entries = Object.entries(odds)
      .map(([candidateId, raw]) => {
        const odd = Number(String(raw).replace(",", "."));
        const candidate = published.find((item) => item.id === candidateId);
        return {
          candidateId,
          odd,
          lineAtEntry:
            candidate?.line_canonical === null || candidate?.line_canonical === undefined
              ? null
              : Number(candidate.line_canonical),
        };
      })
      .filter((entry) => Number.isFinite(entry.odd) && entry.odd > 1);

    if (entries.length === 0) {
      toast.error("Digite pelo menos uma odd válida para comparar.");
      return;
    }
    setSubmitting(true);
    try {
      await analyze({ data: { runId, entries } });
      navigate({ to: "/run/$runId/resultado", params: { runId }, search: { mode: undefined } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível comparar as odds.");
      setSubmitting(false);
    }
  }

  return (
    <AppShell stage="oportunidades">
      <div className="mx-auto max-w-6xl">
        <p className="label-eyebrow">Etapa 3</p>
        <h1 className="page-heading mt-2">Opções para conferir</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">As chances já estão calculadas. Agora compare apenas as odds que quiser.</p>

        {isLoading && (
          <div className="panel mt-6 flex items-center gap-3 p-5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando as opções…
          </div>
        )}

        {!isLoading && published.length === 0 && (
          <p className="mt-5 rounded-lg border border-warning/25 bg-warning/8 px-4 py-3 text-sm text-warning">
            A versão principal não liberou opções nesta rodada. Abaixo aparecem as opções do modo de teste quando houver dados suficientes.
          </p>
        )}

        {published.length > 0 && (
          <section className="panel mt-6 overflow-hidden">
            <div className="hidden md:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-5 py-3 text-xs text-muted-foreground">Jogo / opção</th>
                    <th className="px-5 py-3 text-xs text-muted-foreground">Chance</th>
                    <th className="w-40 px-5 py-3 text-xs text-muted-foreground">Odd bet365</th>
                    <th className="w-32 px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {published.map((candidate) => (
                    <FragmentRow
                      key={candidate.id}
                      candidate={candidate}
                      label={matchLabel.get(candidate.match_id ?? "") ?? ""}
                      value={odds[candidate.id] ?? ""}
                      onChange={(value) => setOdds((current) => ({ ...current, [candidate.id]: value }))}
                      open={Boolean(open[candidate.id])}
                      onToggle={() => setOpen((current) => ({ ...current, [candidate.id]: !current[candidate.id] }))}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-border md:hidden">
              {published.map((candidate) => (
                <article key={candidate.id} className="p-4">
                  <p className="text-sm font-medium">{matchLabel.get(candidate.match_id ?? "") ?? ""}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{candidate.market_label}</p>
                  <div className="mt-3 grid grid-cols-[1fr_120px] items-end gap-3">
                    <div><p className="text-[11px] text-muted-foreground">Chance</p><p className="num mt-1 text-lg">{pct(candidate.p_cal)}</p></div>
                    <label className="text-[11px] text-muted-foreground">Odd bet365<Input inputMode="decimal" value={odds[candidate.id] ?? ""} onChange={(event) => setOdds((current) => ({ ...current, [candidate.id]: event.target.value }))} className="num mt-1 w-full" /></label>
                  </div>
                  <button type="button" onClick={() => setOpen((current) => ({ ...current, [candidate.id]: !current[candidate.id] }))} className="mt-3 inline-flex min-h-10 items-center gap-1 text-xs text-accent">
                    <Info className="size-3" /> {open[candidate.id] ? "Ocultar detalhes" : "Ver detalhes"}
                  </button>
                  {open[candidate.id] && <div className="mt-3"><CandidateDetails candidate={candidate} /></div>}
                </article>
              ))}
            </div>
          </section>
        )}

        {!isLoading && <ExperimentalMarketsPilot runId={runId} />}

        <CollapsiblePanel
          className="mt-4"
          title="Opções que ficaram de fora"
          description="Veja somente se quiser entender o que não passou pela análise"
          meta={blocked.length}
        >
          <ul className="divide-y divide-border">
            {blocked.slice(0, 300).map((candidate) => (
              <li key={candidate.id} className="py-3 text-sm sm:grid sm:grid-cols-[1fr_1fr_auto] sm:gap-3">
                <span>{matchLabel.get(candidate.match_id ?? "") ?? ""}</span>
                <span className="mt-1 block text-muted-foreground sm:mt-0">{candidate.market_label}</span>
                <span className="mt-1 block text-xs text-warning sm:mt-0">{simpleBlockedReason(candidate.block_reason)}</span>
              </li>
            ))}
          </ul>
        </CollapsiblePanel>

        {published.length > 0 && (
          <div className="sticky bottom-0 z-10 mt-4 border-t border-border bg-background/92 py-3 backdrop-blur-xl">
            <Button size="lg" className="min-h-12 w-full" disabled={submitting} onClick={() => void analisar()}>
              {submitting ? "Comparando…" : "COMPARAR ODDS"}
            </Button>
          </div>
        )}

        <SourceAudit runId={runId} refreshKey={0} />
      </div>
    </AppShell>
  );
}

function FragmentRow({ candidate, label, value, onChange, open, onToggle }: {
  candidate: Candidate;
  label: string;
  value: string;
  onChange: (value: string) => void;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b border-border/60 align-middle">
        <td className="px-5 py-3"><p className="font-medium">{label}</p><p className="mt-0.5 text-xs text-muted-foreground">{candidate.market_label}</p></td>
        <td className="num px-5 py-3">{pct(candidate.p_cal)}</td>
        <td className="px-5 py-3"><Input inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} className="num w-28" aria-label={`Odd bet365 para ${candidate.market_label}`} /></td>
        <td className="px-5 py-3"><button type="button" onClick={onToggle} className="inline-flex min-h-10 items-center gap-1 text-xs text-accent"><Info className="size-3" /> {open ? "Ocultar" : "Detalhes"}</button></td>
      </tr>
      {open && (
        <tr className="border-b border-border/60 bg-secondary/20"><td colSpan={4} className="px-5 py-4"><CandidateDetails candidate={candidate} /></td></tr>
      )}
    </>
  );
}
