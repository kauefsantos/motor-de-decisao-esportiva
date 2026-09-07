import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { getResults } from "@/lib/analysis.functions";

export const Route = createFileRoute("/run/$runId/resultado")({
  validateSearch: (search: Record<string, unknown>) => ({
    mode: search.mode === "experimental" ? ("experimental" as const) : undefined,
  }),
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

type ExperimentalStoredEvaluation = {
  predictionId: string;
  matchId: string | null;
  matchLabel: string;
  competition: string;
  marketLabel: string;
  probabilityExperimental: number;
  odd: number;
  fairOdd: number | null;
  minOddTarget: number | null;
  edgeCons: number | null;
  evCons: number | null;
  probabilityStatus: string;
  valueStatus: string;
  executionStatus: string;
  rejectionReason: string | null;
  selected: boolean;
  sampleSize: number;
  trainingMatches: number;
  lineCanonical: number | null;
  modelStatus: string;
  productionStatus: string;
};

type ExperimentalStoredResult = {
  runId: string;
  analyzedAt: string;
  targetDate: string | null;
  dayType: "WEEKDAY" | "WEEKEND";
  selectionLimit: number;
  modelStatus: string;
  productionStatus: string;
  evaluations: ExperimentalStoredEvaluation[];
  selectionOrder: string[];
};

function ResultScreen() {
  const { runId } = Route.useParams();
  const { mode } = Route.useSearch();
  const isExperimental = mode === "experimental";
  const fetchResults = useServerFn(getResults);
  const [showRejected, setShowRejected] = useState(false);
  const [experimental, setExperimental] = useState<ExperimentalStoredResult | null>(null);
  const [experimentalLoaded, setExperimentalLoaded] = useState(!isExperimental);

  useEffect(() => {
    if (!isExperimental) {
      setExperimental(null);
      setExperimentalLoaded(true);
      return;
    }
    try {
      const raw = localStorage.getItem(`experimental-result:${runId}`);
      if (!raw) {
        setExperimental(null);
      } else {
        const parsed = JSON.parse(raw) as ExperimentalStoredResult;
        setExperimental(parsed.runId === runId ? parsed : null);
      }
    } catch {
      setExperimental(null);
    } finally {
      setExperimentalLoaded(true);
    }
  }, [isExperimental, runId]);

  const { data, isLoading } = useQuery({
    queryKey: ["results", runId],
    queryFn: () => fetchResults({ data: { runId } }),
    enabled: !isExperimental,
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

  if (isExperimental) {
    return (
      <ExperimentalResultScreen
        runId={runId}
        data={experimental}
        loaded={experimentalLoaded}
        showRejected={showRejected}
        setShowRejected={setShowRejected}
      />
    );
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

function ExperimentalResultScreen({
  runId,
  data,
  loaded,
  showRejected,
  setShowRejected,
}: {
  runId: string;
  data: ExperimentalStoredResult | null;
  loaded: boolean;
  showRejected: boolean;
  setShowRejected: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  if (!loaded) {
    return (
      <AppShell stage="resultado">
        <div className="panel mt-8 flex items-center gap-3 p-8 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando resultado experimental…
        </div>
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell stage="resultado">
        <p className="label-eyebrow">Etapa 4</p>
        <h1 className="mt-2 text-3xl font-bold">Resultado final experimental</h1>
        <div className="panel mt-8 p-8">
          <p className="text-lg font-medium">Resultado experimental não encontrado.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Volte às oportunidades e rode novamente o Motor 2 experimental para esta análise.
          </p>
        </div>
        <div className="mt-8 flex gap-3">
          <Button asChild variant="outline">
            <Link to="/run/$runId/oportunidades" params={{ runId }}>
              Voltar às oportunidades
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/">Nova análise</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const byPrediction = new Map(data.evaluations.map((evaluation) => [evaluation.predictionId, evaluation]));
  const selected = data.selectionOrder
    .map((predictionId) => byPrediction.get(predictionId))
    .filter((evaluation): evaluation is ExperimentalStoredEvaluation => Boolean(evaluation));
  const selectedIds = new Set(data.selectionOrder);
  const rejected = data.evaluations.filter((evaluation) => !selectedIds.has(evaluation.predictionId));

  return (
    <AppShell stage="resultado">
      <p className="label-eyebrow text-warning">Etapa 4 · Experimental</p>
      <h1 className="mt-2 text-3xl font-bold">Resultado final experimental</h1>
      <p className="mt-2 text-muted-foreground">
        {data.selectionLimit} escolha(s) no máximo nesta rodada — {data.dayType === "WEEKEND" ? "fim de semana" : "dia de semana"}.
      </p>
      <div className="mt-4 rounded-lg border border-warning/50 bg-warning/10 px-4 py-3 text-sm font-semibold text-warning">
        MODELO EXPERIMENTAL — NÃO VALIDADO PARA PRODUÇÃO
      </div>

      {selected.length === 0 && (
        <div className="panel mt-8 p-8">
          <p className="text-lg font-medium">
            Nenhuma oportunidade experimental atingiu os critérios mínimos de valor.
          </p>
        </div>
      )}

      <div className="mt-8 grid gap-6">
        {selected.map((evaluation, index) => (
          <article key={evaluation.predictionId} className="panel border-warning/30 p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="label-eyebrow text-warning">Escolha experimental {index + 1}</p>
                <h2 className="mt-1 text-xl font-semibold">{evaluation.matchLabel}</h2>
                <p className="text-muted-foreground">{evaluation.marketLabel}</p>
              </div>
              <span className="num rounded-md bg-warning/10 px-3 py-1 text-sm text-warning">
                {evaluation.predictionId}
              </span>
            </div>

            <dl className="mt-6 grid gap-5 sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="Odd" value={dec(evaluation.odd)} />
              <Metric label="Prob. experimental" value={pct(evaluation.probabilityExperimental, 1)} />
              <Metric label="Fair odd" value={dec(evaluation.fairOdd)} />
              <Metric label="Odd mín. EV 2%" value={dec(evaluation.minOddTarget)} />
              <Metric label="Edge" value={pct(evaluation.edgeCons)} />
              <Metric label="EV" value={pct(evaluation.evCons)} />
            </dl>

            <div className="mt-5 flex flex-wrap gap-2 text-[11px]">
              <Tag>VALOR: {evaluation.valueStatus}</Tag>
              <Tag>EXECUÇÃO: {evaluation.executionStatus}</Tag>
              <Tag>AMOSTRA TIME: {evaluation.sampleSize}</Tag>
              <Tag>JOGOS LIGA: {evaluation.trainingMatches}</Tag>
            </div>

            <p className="mt-4 text-xs font-semibold text-warning">
              {data.modelStatus} · produção: {data.productionStatus}
            </p>
          </article>
        ))}
      </div>

      <div className="panel mt-8">
        <button
          type="button"
          onClick={() => setShowRejected((s) => !s)}
          className="flex w-full items-center justify-between px-6 py-4 text-left"
        >
          <span className="text-sm font-medium">Outras odds avaliadas ({rejected.length})</span>
          <ChevronDown
            className={`size-4 transition-transform ${showRejected ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
        {showRejected && (
          <ul className="divide-y divide-border border-t border-border">
            {rejected.map((evaluation) => (
              <li
                key={evaluation.predictionId}
                className="grid gap-1 px-6 py-3 md:grid-cols-[1fr_1fr_auto_auto_auto]"
              >
                <span className="text-sm">{evaluation.matchLabel}</span>
                <span className="text-sm text-muted-foreground">{evaluation.marketLabel}</span>
                <span className="num text-xs">odd {dec(evaluation.odd)}</span>
                <span className="num text-xs">EV {pct(evaluation.evCons)}</span>
                <span className="num text-[11px] text-warning">
                  {evaluation.rejectionReason ?? evaluation.valueStatus}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link to="/run/$runId/oportunidades" params={{ runId }}>
            Voltar às oportunidades
          </Link>
        </Button>
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
