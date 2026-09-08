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
    mode: search["mode"] === "experimental" ? ("experimental" as const) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Seleções finais · Bet Value Engine" },
      {
        name: "description",
        content: "Veja quais mercados continuaram interessantes depois de comparar a nossa estimativa com as odds informadas.",
      },
      { property: "og:title", content: "Seleções finais · Bet Value Engine" },
      {
        property: "og:description",
        content: "O sistema pode escolher poucos mercados ou nenhum quando o preço não compensa.",
      },
    ],
  }),
  component: ResultScreen,
});

const pct = (v: unknown, digits = 2) =>
  v === null || v === undefined ? "—" : `${(Number(v) * 100).toFixed(digits)}%`;
const dec = (v: unknown) => (v === null || v === undefined ? "—" : Number(v).toFixed(2));

function friendlyReason(reason: string | null | undefined) {
  if (!reason) return "Ficou fora da seleção final";
  const labels: Record<string, string> = {
    SEM_VALOR: "A odd não oferecia margem suficiente",
    PRICE_MOVED_NO_BET: "O preço mudou e deixou de compensar",
    REFORECAST_REQUIRED: "A linha mudou e precisa ser recalculada",
    MODEL_NOT_PRODUCTION_VALIDATED: "O modelo ainda está em validação",
    DATA_DEFINITION_MISMATCH: "Os dados disponíveis não combinam com esse mercado",
    INSUFFICIENT_DATA: "Faltaram dados suficientes",
    INVALID_ODD: "Odd inválida",
    BOOKMAKER_MISMATCH: "Preço informado de outra casa",
  };
  return labels[reason] ?? reason;
}

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
      <h1 className="mt-2 text-3xl font-bold">Seleções finais</h1>
      <p className="mt-2 text-muted-foreground">
        Aqui ficam apenas os mercados que continuaram interessantes depois de comparar chance e preço. Se nada compensar, a lista fica vazia.
      </p>

      {isLoading && (
        <div className="panel mt-8 flex items-center gap-3 p-8 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Conferindo as odds…
        </div>
      )}

      {!isLoading && selected.length === 0 && (
        <div className="panel mt-8 p-8">
          <p className="text-lg font-medium">Nenhuma odd ofereceu margem suficiente nesta rodada.</p>
          <p className="mt-2 text-sm text-muted-foreground">Isso é um resultado válido: o sistema não força uma escolha.</p>
        </div>
      )}

      <div className="mt-8 grid gap-6">
        {selected.map(({ selection, evaluation }) => {
          const info = labelFor(evaluation.candidate_id);
          return (
            <article key={selection.id} className="panel p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="label-eyebrow">Seleção {selection.rank}</p>
                  <h2 className="mt-1 text-xl font-semibold">{info.partida}</h2>
                  <p className="text-muted-foreground">{info.mercado}</p>
                </div>
              </div>

              <dl className="mt-6 grid gap-5 sm:grid-cols-3 lg:grid-cols-6">
                <Metric label="Odd informada" value={dec(evaluation.odd)} />
                <Metric label="Chance usada" value={pct(evaluation.w_eff ?? null, 1)} />
                <Metric label="Odd justa" value={dec(evaluation.fair_odd)} />
                <Metric label="Odd mínima" value={dec(evaluation.min_odd_target)} />
                <Metric label="Margem" value={pct(evaluation.edge_cons)} />
                <Metric label="Retorno esperado" value={pct(evaluation.ev_cons)} />
              </dl>

              <p className="mt-4 text-sm text-muted-foreground">{selection.explanation}</p>
              <details className="mt-4 text-xs text-muted-foreground">
                <summary className="cursor-pointer">Detalhes técnicos</summary>
                <p className="num mt-2">ID: {info.predictionId}</p>
                <p className="mt-1">{evaluation.probability_status} · {evaluation.value_status} · {evaluation.execution_status}</p>
                <p className="mt-1">{info.c?.settlement_definition}</p>
              </details>
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
          <span className="text-sm font-medium">Outras odds avaliadas ({rejected.length})</span>
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
                  <span className="text-[11px] text-warning">{friendlyReason(e.rejection_reason)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link to="/">Nova análise</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/analytics">Ver desempenho</Link>
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
          <Loader2 className="size-4 animate-spin" aria-hidden /> Preparando o resultado…
        </div>
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell stage="resultado">
        <p className="label-eyebrow">Etapa 4</p>
        <h1 className="mt-2 text-3xl font-bold">Seleções do modo de teste</h1>
        <div className="panel mt-8 p-8">
          <p className="text-lg font-medium">Não encontrei o resultado desta análise.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Volte à tela anterior e compare as odds novamente.
          </p>
        </div>
        <div className="mt-8 flex gap-3">
          <Button asChild variant="outline">
            <Link to="/run/$runId/oportunidades" params={{ runId }}>
              Voltar aos mercados
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
      <p className="label-eyebrow text-warning">Etapa 4 · Modo de teste</p>
      <h1 className="mt-2 text-3xl font-bold">Seleções do dia</h1>
      <p className="mt-2 text-muted-foreground">
        O limite desta rodada é de {data.selectionLimit} seleção(ões). O sistema pode escolher menos — ou nenhuma — quando o preço não compensa.
      </p>
      <div className="mt-4 rounded-lg border border-warning/50 bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
        Ainda estamos validando o modelo com resultados reais. Estas seleções entram no painel de desempenho a partir de 08/09/2026.
      </div>

      {selected.length === 0 && (
        <div className="panel mt-8 p-8">
          <p className="text-lg font-medium">Nenhuma odd ofereceu margem suficiente nesta rodada.</p>
          <p className="mt-2 text-sm text-muted-foreground">Não escolher também faz parte do teste.</p>
        </div>
      )}

      <div className="mt-8 grid gap-6">
        {selected.map((evaluation, index) => (
          <article key={evaluation.predictionId} className="panel border-warning/30 p-6">
            <div>
              <p className="label-eyebrow text-warning">Seleção {index + 1}</p>
              <h2 className="mt-1 text-xl font-semibold">{evaluation.matchLabel}</h2>
              <p className="text-muted-foreground">{evaluation.marketLabel}</p>
            </div>

            <dl className="mt-6 grid gap-5 sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="Odd informada" value={dec(evaluation.odd)} />
              <Metric label="Chance estimada" value={pct(evaluation.probabilityExperimental, 1)} />
              <Metric label="Odd justa" value={dec(evaluation.fairOdd)} />
              <Metric label="Odd mínima" value={dec(evaluation.minOddTarget)} />
              <Metric label="Margem" value={pct(evaluation.edgeCons)} />
              <Metric label="Retorno esperado" value={pct(evaluation.evCons)} />
            </dl>

            <div className="mt-5 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              <span className="rounded-md bg-secondary px-2.5 py-1">Base do time: {evaluation.sampleSize} jogo(s)</span>
              <span className="rounded-md bg-secondary px-2.5 py-1">Base da liga: {evaluation.trainingMatches} jogo(s)</span>
            </div>

            <details className="mt-4 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Detalhes técnicos</summary>
              <p className="num mt-2">ID: {evaluation.predictionId}</p>
              <p className="mt-1">{data.modelStatus} · {data.productionStatus}</p>
            </details>
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
                className="grid gap-1 px-6 py-3 md:grid-cols-[1fr_1fr_auto_auto]"
              >
                <span className="text-sm">{evaluation.matchLabel}</span>
                <span className="text-sm text-muted-foreground">{evaluation.marketLabel}</span>
                <span className="num text-xs">odd {dec(evaluation.odd)}</span>
                <span className="text-[11px] text-warning">
                  {friendlyReason(evaluation.rejectionReason)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link to="/run/$runId/oportunidades" params={{ runId }}>
            Voltar aos mercados
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/">Nova análise</Link>
        </Button>
        <Button asChild>
          <Link to="/analytics">Ver desempenho</Link>
        </Button>
      </div>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="num mt-1 text-lg">{value}</dd>
    </div>
  );
}
