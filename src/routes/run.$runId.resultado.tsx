import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { getResults } from "@/lib/analysis.functions";

export const Route = createFileRoute("/run/$runId/resultado")({
  head: () => ({
    meta: [
      { title: "Resultado final · Bet Value Engine" },
      {
        name: "description",
        content:
          "De zero a no máximo três escolhas finais com EV conservador, fair odd e odd mínima para 2%.",
      },
      { property: "og:title", content: "Resultado final · Bet Value Engine" },
      {
        property: "og:description",
        content: "Escolhas finais auditáveis com probabilidade, valor e execução separados.",
      },
    ],
  }),
  component: ResultScreen,
});

const pct = (v: unknown, digits = 2) =>
  v === null || v === undefined ? "—" : `${(Number(v) * 100).toFixed(digits)}%`;
const dec = (v: unknown) => (v === null || v === undefined ? "—" : Number(v).toFixed(2));

function ResultScreen() {
  const { runId } = Route.useParams();
  const fetchResults = useServerFn(getResults);
  const [showRejected, setShowRejected] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["results", runId],
    queryFn: () => fetchResults({ data: { runId } }),
  });

  const candidateById = useMemo(
    () => new Map((data?.candidates ?? []).map((c) => [c.id, c])),
    [data],
  );
  const matchById = useMemo(() => new Map((data?.matches ?? []).map((m) => [m.id, m])), [data]);

  const selectedEvalIds = new Set((data?.selections ?? []).map((s) => s.evaluation_id));
  const selected = (data?.selections ?? []).map((s) => ({
    selection: s,
    evaluation: (data?.evaluations ?? []).find((e) => e.id === s.evaluation_id)!,
  }));
  const rejected = (data?.evaluations ?? []).filter((e) => !selectedEvalIds.has(e.id));

  function labelFor(candidateId: string) {
    const c = candidateById.get(candidateId);
    const m = c?.match_id ? matchById.get(c.match_id) : null;
    const partida = m
      ? m.home_team && m.away_team
        ? `${m.home_team} x ${m.away_team}`
        : m.raw_partida
      : "—";
    return { partida, mercado: c?.market_label ?? "—", predictionId: c?.prediction_id ?? "—", c };
  }

  return (
    <AppShell stage="resultado">
      <p className="label-eyebrow">Etapa 4</p>
      <h1 className="mt-2 text-3xl font-bold">Resultado final</h1>
      <p className="mt-2 text-muted-foreground">
        No máximo três escolhas. Se nada atinge os critérios, o motor devolve zero.
      </p>

      {isLoading && (
        <div className="panel mt-8 flex items-center gap-3 p-8 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando avaliação…
        </div>
      )}

      {!isLoading && selected.length === 0 && (
        <div className="panel mt-8 p-8">
          <p className="text-lg font-medium">
            Nenhuma oportunidade atingiu os critérios mínimos do modelo e de valor.
          </p>
        </div>
      )}

      <div className="mt-8 grid gap-6">
        {selected.map(({ selection, evaluation }) => {
          const info = labelFor(evaluation.candidate_id);
          return (
            <article key={selection.id} className="panel p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="label-eyebrow">Escolha {selection.rank}</p>
                  <h2 className="mt-1 text-xl font-semibold">{info.partida}</h2>
                  <p className="text-muted-foreground">{info.mercado}</p>
                </div>
                <span className="num rounded-md bg-primary/15 px-3 py-1 text-sm text-primary">
                  {info.predictionId}
                </span>
              </div>

              <dl className="mt-6 grid gap-5 sm:grid-cols-3 lg:grid-cols-6">
                <Metric label="Odd" value={dec(evaluation.odd)} />
                <Metric label="Prob. conservadora" value={pct(evaluation.w_eff ?? null, 1)} />
                <Metric label="Fair odd" value={dec(evaluation.fair_odd)} />
                <Metric label="Odd mín. EV 2%" value={dec(evaluation.min_odd_target)} />
                <Metric label="Edge conservador" value={pct(evaluation.edge_cons)} />
                <Metric label="EV conservador" value={pct(evaluation.ev_cons)} />
              </dl>

              <div className="mt-5 flex flex-wrap gap-2 text-[11px]">
                <Tag>PROBABILIDADE: {evaluation.probability_status}</Tag>
                <Tag>VALOR: {evaluation.value_status}</Tag>
                <Tag>EXECUÇÃO: {evaluation.execution_status}</Tag>
                <Tag>Confidence {pct(info.c?.confidence_score, 1)}</Tag>
                <Tag>Data quality {pct(info.c?.data_quality_score, 1)}</Tag>
              </div>

              <p className="mt-4 text-sm text-muted-foreground">{selection.explanation}</p>
              <p className="mt-2 text-xs text-muted-foreground">{info.c?.settlement_definition}</p>
            </article>
          );
        })}
      </div>

      <div className="panel mt-8">
        <button
          type="button"
          onClick={() => setShowRejected((s) => !s)}
          className="flex w-full items-center justify-between px-6 py-4 text-left"
        >
          <span className="text-sm font-medium">Rejeitados ({rejected.length})</span>
          <ChevronDown
            className={`size-4 transition-transform ${showRejected ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
        {showRejected && (
          <ul className="divide-y divide-border border-t border-border">
            {rejected.map((e) => {
              const info = labelFor(e.candidate_id);
              return (
                <li key={e.id} className="grid gap-1 px-6 py-3 md:grid-cols-[1fr_1fr_auto_auto]">
                  <span className="text-sm">{info.partida}</span>
                  <span className="text-sm text-muted-foreground">{info.mercado}</span>
                  <span className="num text-xs">odd {dec(e.odd)}</span>
                  <span className="num text-[11px] text-warning">{e.rejection_reason}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-8">
        <Button asChild variant="outline">
          <Link to="/">Nova análise</Link>
        </Button>
      </div>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label-eyebrow">{label}</dt>
      <dd className="num mt-1 text-lg">{value}</dd>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="num rounded-md bg-secondary px-2.5 py-1 text-secondary-foreground">
      {children}
    </span>
  );
}
