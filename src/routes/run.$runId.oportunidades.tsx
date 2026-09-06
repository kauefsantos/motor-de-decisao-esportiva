import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ChevronDown, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getRun, analyzeOdds } from "@/lib/analysis.functions";

export const Route = createFileRoute("/run/$runId/oportunidades")({
  head: () => ({
    meta: [
      { title: "Mercados para observar · Bet Value Engine" },
      {
        name: "description",
        content:
          "Contratos aprovados pelo motor de oportunidade, com espaço para digitar a odd da bet365 Brasil.",
      },
      { property: "og:title", content: "Mercados para observar · Bet Value Engine" },
      {
        property: "og:description",
        content: "Probabilidade primeiro, preço depois: digite as odds e rode o motor de valor.",
      },
    ],
  }),
  component: OpportunitiesScreen,
});

type Candidate = Awaited<ReturnType<typeof getRun>>["candidates"][number];

function OpportunitiesScreen() {
  const { runId } = Route.useParams();
  const navigate = useNavigate();
  const fetchRun = useServerFn(getRun);
  const analyze = useServerFn(analyzeOdds);
  const [odds, setOdds] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showBlocked, setShowBlocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => fetchRun({ data: { runId } }),
  });

  const matchLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of data?.matches ?? []) {
      map.set(
        m.id,
        `${m.home_team && m.away_team ? `${m.home_team} x ${m.away_team}` : m.raw_partida} · ${
          m.competition ?? ""
        }`,
      );
    }
    return map;
  }, [data]);

  const published = (data?.candidates ?? []).filter((c) => c.published);
  const blocked = (data?.candidates ?? []).filter((c) => !c.published);

  async function analisar() {
    const entries = Object.entries(odds)
      .map(([candidateId, raw]) => {
        const odd = Number(String(raw).replace(",", "."));
        const candidate = published.find((c) => c.id === candidateId);
        return {
          candidateId,
          odd,
          lineAtEntry: candidate?.line_canonical === null || candidate?.line_canonical === undefined
            ? null
            : Number(candidate.line_canonical),
        };
      })
      .filter((e) => Number.isFinite(e.odd) && e.odd > 1);

    if (entries.length === 0) {
      toast.error("Digite ao menos uma odd válida (maior que 1).");
      return;
    }
    setSubmitting(true);
    try {
      await analyze({ data: { runId, entries } });
      navigate({ to: "/run/$runId/resultado", params: { runId } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao analisar odds.");
      setSubmitting(false);
    }
  }

  return (
    <AppShell stage="oportunidades">
      <p className="label-eyebrow">Etapa 3</p>
      <h1 className="mt-2 text-3xl font-bold">Mercados para observar</h1>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        A escolha do mercado não usou nenhuma odd. Digite manualmente a odd da bet365 Brasil apenas
        nos contratos que quiser avaliar.
      </p>

      {isLoading && (
        <div className="panel mt-8 flex items-center gap-3 p-8 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando contratos…
        </div>
      )}

      {!isLoading && published.length === 0 && (
        <div className="panel mt-8 p-8">
          <p className="font-medium">Nenhum contrato foi publicado pelo motor de oportunidade.</p>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Nenhuma fonte de dados está configurada e nenhum modelo está validado em produção, então
            o motor bloqueou os mercados em vez de inventar probabilidade. Abra a lista abaixo para
            ver o motivo contrato a contrato.
          </p>
        </div>
      )}

      {published.length > 0 && (
        <div className="panel mt-8 overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="label-eyebrow px-6 py-3">A · Jogo</th>
                <th className="label-eyebrow px-6 py-3">B · Mercado para observar</th>
                <th className="label-eyebrow w-40 px-6 py-3">C · Odd</th>
              </tr>
            </thead>
            <tbody>
              {published.map((c) => (
                <CandidateRow
                  key={c.id}
                  candidate={c}
                  label={matchLabel.get(c.match_id ?? "") ?? ""}
                  value={odds[c.id] ?? ""}
                  onChange={(v) => setOdds((p) => ({ ...p, [c.id]: v }))}
                  open={Boolean(open[c.id])}
                  onToggle={() => setOpen((p) => ({ ...p, [c.id]: !p[c.id] }))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel mt-6">
        <button
          type="button"
          onClick={() => setShowBlocked((s) => !s)}
          className="flex w-full items-center justify-between px-6 py-4 text-left"
        >
          <span className="text-sm font-medium">
            Contratos bloqueados pelo Motor 1 ({blocked.length})
          </span>
          <ChevronDown
            className={`size-4 transition-transform ${showBlocked ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
        {showBlocked && (
          <ul className="divide-y divide-border border-t border-border">
            {blocked.slice(0, 300).map((c) => (
              <li key={c.id} className="grid gap-1 px-6 py-3 md:grid-cols-[1fr_1fr_auto]">
                <span className="text-sm">{matchLabel.get(c.match_id ?? "") ?? ""}</span>
                <span className="text-sm text-muted-foreground">{c.market_label}</span>
                <span className="num text-[11px] text-warning">{c.block_reason}</span>
                <span className="text-xs text-muted-foreground md:col-span-3">{c.reason_short}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {Object.keys(data?.sourceSummary ?? {}).length > 0 && (
        <div className="panel mt-6 p-6">
          <p className="label-eyebrow">Estado das fontes nesta rodada</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {Object.entries(data!.sourceSummary).map(([k, v]) => (
              <li key={k} className="num rounded-md bg-secondary px-2.5 py-1 text-[11px]">
                {k} · {v}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="sticky bottom-0 mt-8 border-t border-border bg-background/90 py-5 backdrop-blur">
        <Button
          size="lg"
          className="w-full text-base"
          disabled={submitting || published.length === 0}
          onClick={() => void analisar()}
        >
          {submitting ? "Analisando…" : "ANALISAR ODDS"}
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Só as odds válidas serão avaliadas. Mudança de mercado ou de linha exige novo forecast.
        </p>
      </div>
    </AppShell>
  );
}

function CandidateRow({
  candidate,
  label,
  value,
  onChange,
  open,
  onToggle,
}: {
  candidate: Candidate;
  label: string;
  value: string;
  onChange: (v: string) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const pct = (v: number | string | null) =>
    v === null ? "—" : `${(Number(v) * 100).toFixed(1)}%`;
  return (
    <>
      <tr className="border-b border-border/60 align-top">
        <td className="px-6 py-4">{label}</td>
        <td className="px-6 py-4">
          <div className="font-medium">{candidate.market_label}</div>
          <button
            type="button"
            onClick={onToggle}
            className="mt-1 inline-flex items-center gap-1 text-xs text-accent"
          >
            <Info className="size-3" aria-hidden /> detalhes
          </button>
        </td>
        <td className="px-6 py-4">
          <Input
            inputMode="decimal"
            placeholder=""
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="num w-28"
            aria-label={`Odd bet365 para ${candidate.market_label}`}
          />
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border/60 bg-secondary/30">
          <td colSpan={3} className="px-6 py-4">
            <dl className="grid gap-4 text-xs sm:grid-cols-4">
              <div>
                <dt className="label-eyebrow">p_cal</dt>
                <dd className="num mt-1">{pct(candidate.p_cal)}</dd>
              </div>
              <div>
                <dt className="label-eyebrow">p_cons</dt>
                <dd className="num mt-1">{pct(candidate.p_cons)}</dd>
              </div>
              <div>
                <dt className="label-eyebrow">Fair odd informativa</dt>
                <dd className="num mt-1">
                  {candidate.fair_odd_info ? Number(candidate.fair_odd_info).toFixed(2) : "—"}
                </dd>
              </div>
              <div>
                <dt className="label-eyebrow">Confidence</dt>
                <dd className="num mt-1">{pct(candidate.confidence_score)}</dd>
              </div>
              <div>
                <dt className="label-eyebrow">Data quality</dt>
                <dd className="num mt-1">{pct(candidate.data_quality_score)}</dd>
              </div>
              <div>
                <dt className="label-eyebrow">Incerteza</dt>
                <dd className="num mt-1">{pct(candidate.uncertainty)}</dd>
              </div>
              <div>
                <dt className="label-eyebrow">Modelo / dados</dt>
                <dd className="num mt-1">
                  {candidate.model_status} · {candidate.data_status}
                </dd>
              </div>
              <div>
                <dt className="label-eyebrow">prediction_id</dt>
                <dd className="num mt-1">{candidate.prediction_id}</dd>
              </div>
              <div className="sm:col-span-4">
                <dt className="label-eyebrow">Settlement</dt>
                <dd className="mt-1 text-muted-foreground">{candidate.settlement_definition}</dd>
              </div>
              <div className="sm:col-span-4">
                <dt className="label-eyebrow">Razão</dt>
                <dd className="mt-1 text-muted-foreground">{candidate.reason_short}</dd>
              </div>
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}
