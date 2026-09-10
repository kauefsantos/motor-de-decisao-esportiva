import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { Button } from "@/components/ui/button";
import { getResults } from "@/lib/analysis.functions";
import { promoteQualifiedExperimentalBet } from "@/lib/qualified-alternates.functions";

export const Route = createFileRoute("/run/$runId/resultado")({
  validateSearch: (search: Record<string, unknown>) => ({
    mode: search["mode"] === "experimental" ? ("experimental" as const) : undefined,
  }),
  head: () => ({ meta: [{ title: "Sugestões finais · Bet Value Engine" }] }),
  component: ResultScreen,
});

const pct = (v: unknown, digits = 2) =>
  v === null || v === undefined ? "—" : `${(Number(v) * 100).toFixed(digits)}%`;
const dec = (v: unknown) => (v === null || v === undefined ? "—" : Number(v).toFixed(2));
const line = (v: number) => v.toFixed(1).replace(".", ",");

function friendlyReason(reason: string | null | undefined) {
  if (!reason) return "Ficou fora das sugestões finais";
  const labels: Record<string, string> = {
    SEM_VALOR: "A odd não oferecia vantagem suficiente",
    PRICE_MOVED_NO_BET: "A odd mudou e deixou de compensar",
    REFORECAST_REQUIRED: "A linha mudou e precisa ser recalculada",
    MODEL_NOT_PRODUCTION_VALIDATED: "Esta análise ainda está em fase de teste",
    DATA_DEFINITION_MISMATCH: "Os dados disponíveis não combinam com esta opção",
    INSUFFICIENT_DATA: "Faltaram dados suficientes",
    INVALID_ODD: "A odd informada não é válida",
    BOOKMAKER_MISMATCH: "A odd informada não corresponde à casa esperada",
  };
  return labels[reason] ?? "Esta opção não atingiu todos os critérios necessários";
}

function friendlyStatus(status: string | null | undefined) {
  if (!status) return "—";
  const labels: Record<string, string> = {
    OK: "Tudo certo",
    READY: "Pronto",
    VALID: "Dados suficientes",
    TEM_VALOR: "Preço interessante",
    SEM_VALOR: "Preço não compensa",
    EXECUTAVEL: "Disponível",
    NAO_EXECUTAVEL: "Não disponível",
    MODEL_NOT_PRODUCTION_VALIDATED: "Ainda em fase de teste",
    DATA_DEFINITION_MISMATCH: "Dados incompatíveis",
    INSUFFICIENT_DATA: "Dados insuficientes",
  };
  return labels[status] ?? "Em verificação";
}

function directionLabel(direction: ExperimentalDirectionAssessment["direction"]) {
  const labels: Record<ExperimentalDirectionAssessment["direction"], string> = {
    VALUE_OVER: "Mais tem value confirmado",
    VALUE_UNDER: "Menos tem value confirmado",
    MODEL_LEAN_OVER: "Modelo pende para Mais — sem value confirmado",
    MODEL_LEAN_UNDER: "Modelo pende para Menos — sem value confirmado",
    NEUTRAL: "Sem direção clara",
  };
  return labels[direction];
}

function directionMarketLabel(assessment: ExperimentalDirectionAssessment) {
  const scope = assessment.participant ? ` · ${assessment.participant}` : "";
  if (assessment.market === "corners_match_total") return "Escanteios da partida";
  if (assessment.market === "corners_team_total") return `Escanteios${scope}`;
  if (assessment.market === "cards_match_total") return "Cartões da partida";
  if (assessment.market === "cards_team_total") return `Cartões${scope}`;
  if (assessment.market === "goals_match_total") return "Gols da partida";
  return assessment.market;
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

type ExperimentalReferenceAlternative = {
  matchId: string;
  market: string;
  participant: string | null;
  side: "OVER" | "UNDER";
  lineCanonical: number;
  marketLabel: string;
  probabilityExperimental: number;
  fairOdd: number | null;
  minOddTarget: number | null;
  requiresRealOdd: true;
  valueStatus: "NAO_AVALIADO";
};

type ExperimentalDirectionAssessment = {
  matchId: string;
  market: string;
  participant: string | null;
  anchorLine: number;
  direction:
    | "VALUE_OVER"
    | "VALUE_UNDER"
    | "MODEL_LEAN_OVER"
    | "MODEL_LEAN_UNDER"
    | "NEUTRAL";
  basis: "VALUE" | "MODEL_ONLY" | "NEUTRAL";
  overProbability: number;
  underProbability: number;
  bestValuePredictionId: string | null;
  referenceAlternatives: ExperimentalReferenceAlternative[];
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
  directionAssessments?: ExperimentalDirectionAssessment[];
  referenceAlternatives?: ExperimentalReferenceAlternative[];
};

function ResultScreen() {
  const { runId } = Route.useParams();
  const { mode } = Route.useSearch();
  const isExperimental = mode === "experimental";
  const fetchResults = useServerFn(getResults);
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

  const candidateById = useMemo(() => new Map((data?.candidates ?? []).map((c) => [c.id, c])), [data]);
  const matchById = useMemo(() => new Map((data?.matches ?? []).map((m) => [m.id, m])), [data]);
  const selectedEvalIds = new Set((data?.selections ?? []).map((s) => s.evaluation_id));
  const selected = (data?.selections ?? []).map((s) => ({
    selection: s,
    evaluation: (data?.evaluations ?? []).find((e) => e.id === s.evaluation_id)!,
  }));
  const rejected = (data?.evaluations ?? []).filter((e) => !selectedEvalIds.has(e.id));

  function labelFor(candidateId: string) {
    const candidate = candidateById.get(candidateId);
    const match = candidate?.match_id ? matchById.get(candidate.match_id) : null;
    const partida = match
      ? match.home_team && match.away_team
        ? `${match.home_team} x ${match.away_team}`
        : match.raw_partida
      : "—";
    return { partida, mercado: candidate?.market_label ?? "—", predictionId: candidate?.prediction_id ?? "—", candidate };
  }

  if (isExperimental) {
    return <ExperimentalResultScreen runId={runId} data={experimental} loaded={experimentalLoaded} />;
  }

  return (
    <AppShell stage="resultado">
      <div className="mx-auto max-w-5xl">
        <p className="label-eyebrow">Etapa 4</p>
        <h1 className="page-heading mt-2">Sugestões finais</h1>
        <p className="mt-2 text-sm text-muted-foreground">Só ficam aqui as opções em que chance e odd continuam fazendo sentido juntas.</p>

        {isLoading && (
          <div className="panel mt-6 flex items-center gap-3 p-5 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Conferindo as odds…</div>
        )}

        {!isLoading && selected.length === 0 && (
          <div className="panel mt-6 p-5"><p className="font-medium">Nenhuma odd compensou nesta rodada.</p><p className="mt-1 text-sm text-muted-foreground">O sistema não força uma sugestão.</p></div>
        )}

        <div className="mt-6 grid gap-4">
          {selected.map(({ selection, evaluation }) => {
            const info = labelFor(evaluation.candidate_id);
            return (
              <article key={selection.id} className="panel overflow-hidden">
                <div className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><p className="label-eyebrow">Sugestão {selection.rank}</p><h2 className="mt-1 text-lg font-semibold sm:text-xl">{info.partida}</h2><p className="text-sm text-muted-foreground">{info.mercado}</p></div>
                    <div className="grid grid-cols-3 gap-2 text-right sm:min-w-72">
                      <SummaryMetric label="Odd" value={dec(evaluation.odd)} />
                      <SummaryMetric label="Chance" value={pct(evaluation.w_eff ?? null, 1)} />
                      <SummaryMetric label="Retorno" value={pct(evaluation.ev_cons, 1)} highlight />
                    </div>
                  </div>
                  {selection.explanation && <p className="mt-3 text-sm text-muted-foreground">{selection.explanation}</p>}
                </div>
                <CollapsiblePanel className="m-3 mt-0 bg-transparent shadow-none sm:m-4 sm:mt-0" title="Ver análise completa" description="Preço de referência, vantagem e situação da sugestão">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <MetricTile label="Odd de referência" value={dec(evaluation.fair_odd)} />
                    <MetricTile label="Odd mínima" value={dec(evaluation.min_odd_target)} />
                    <MetricTile label="Vantagem" value={pct(evaluation.edge_cons)} />
                    <MetricTile label="Disponibilidade" value={friendlyStatus(evaluation.execution_status)} />
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">Chance: {friendlyStatus(evaluation.probability_status)} · Preço: {friendlyStatus(evaluation.value_status)} · Referência: <span className="num">{info.predictionId}</span></p>
                </CollapsiblePanel>
              </article>
            );
          })}
        </div>

        <CollapsiblePanel className="mt-4" title="Outras odds conferidas" description="Opções avaliadas que não entraram nas sugestões" meta={rejected.length}>
          <ul className="divide-y divide-border">
            {rejected.map((evaluation) => {
              const info = labelFor(evaluation.candidate_id);
              return (
                <li key={evaluation.id} className="py-3 text-sm sm:grid sm:grid-cols-[1fr_1fr_auto] sm:gap-3">
                  <span>{info.partida}</span><span className="mt-1 block text-muted-foreground sm:mt-0">{info.mercado} · odd {dec(evaluation.odd)}</span><span className="mt-1 block text-xs text-warning sm:mt-0">{friendlyReason(evaluation.rejection_reason)}</span>
                </li>
              );
            })}
          </ul>
        </CollapsiblePanel>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="outline"><Link to="/">Nova análise</Link></Button>
          <Button asChild variant="outline"><Link to="/analytics">Ver desempenho</Link></Button>
        </div>
      </div>
    </AppShell>
  );
}

function ExperimentalResultScreen({ runId, data, loaded }: {
  runId: string;
  data: ExperimentalStoredResult | null;
  loaded: boolean;
}) {
  const promote = useServerFn(promoteQualifiedExperimentalBet);
  const queryClient = useQueryClient();
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [promotedIds, setPromotedIds] = useState<Set<string>>(() => new Set());

  async function selectAlternate(evaluation: ExperimentalStoredEvaluation) {
    setPromotingId(evaluation.predictionId);
    try {
      await promote({
        data: {
          runId,
          predictionId: evaluation.predictionId,
          odd: Number(evaluation.odd),
          lineAtEntry: evaluation.lineCanonical,
        },
      });
      setPromotedIds((current) => new Set(current).add(evaluation.predictionId));
      await queryClient.invalidateQueries({ queryKey: ["experimental-bet-plan", runId] });
      toast.success("Opção adicionada à confirmação.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível escolher esta opção.");
    } finally {
      setPromotingId(null);
    }
  }

  if (!loaded) {
    return <AppShell stage="resultado"><div className="panel mx-auto mt-6 flex max-w-5xl items-center gap-3 p-5 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Preparando o resultado…</div></AppShell>;
  }

  if (!data) {
    return (
      <AppShell stage="resultado">
        <div className="mx-auto max-w-5xl"><p className="label-eyebrow">Etapa 4</p><h1 className="page-heading mt-2">Sugestões do modo de teste</h1><div className="panel mt-6 p-5"><p className="font-medium">Não encontrei o resultado desta análise.</p><p className="mt-1 text-sm text-muted-foreground">Volte à tela anterior e compare as odds novamente.</p></div><Button asChild className="mt-4" variant="outline"><Link to="/run/$runId/oportunidades" params={{ runId }}>Voltar às opções</Link></Button></div>
      </AppShell>
    );
  }

  const byPrediction = new Map(data.evaluations.map((evaluation) => [evaluation.predictionId, evaluation]));
  const selected = data.selectionOrder.map((predictionId) => byPrediction.get(predictionId)).filter((evaluation): evaluation is ExperimentalStoredEvaluation => Boolean(evaluation));
  const selectedIds = new Set(data.selectionOrder);
  const rejected = data.evaluations.filter((evaluation) => !selectedIds.has(evaluation.predictionId));
  const qualifiedAlternates = rejected
    .filter((evaluation) => evaluation.valueStatus === "TEM_VALOR" && evaluation.executionStatus === "EXECUTAVEL")
    .sort((a, b) => (b.evCons ?? 0) - (a.evCons ?? 0) || (b.edgeCons ?? 0) - (a.edgeCons ?? 0));
  const withoutValue = rejected.filter((evaluation) => evaluation.valueStatus !== "TEM_VALOR" || evaluation.executionStatus !== "EXECUTAVEL");
  const directionAssessments = data.directionAssessments ?? [];

  return (
    <AppShell stage="resultado">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center gap-2"><p className="label-eyebrow">Etapa 4</p><span className="rounded-full bg-warning/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-warning">Modo de teste</span></div>
        <h1 className="page-heading mt-2">Sugestões do dia</h1>
        <p className="mt-2 text-sm text-muted-foreground">Até {data.selectionLimit} sugestão(ões); pode haver menos ou nenhuma.</p>

        {selected.length === 0 && <div className="panel mt-6 p-5"><p className="font-medium">Nenhuma odd compensou nesta rodada.</p><p className="mt-1 text-sm text-muted-foreground">Não escolher também faz parte do teste.</p></div>}

        <div className="mt-6 grid gap-4">
          {selected.map((evaluation, index) => (
            <article key={evaluation.predictionId} className="panel overflow-hidden border-warning/20">
              <div className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="label-eyebrow text-warning">Sugestão {index + 1}</p><h2 className="mt-1 text-lg font-semibold sm:text-xl">{evaluation.matchLabel}</h2><p className="text-sm text-muted-foreground">{evaluation.marketLabel}</p></div>
                  <div className="grid grid-cols-3 gap-2 text-right sm:min-w-72">
                    <SummaryMetric label="Odd" value={dec(evaluation.odd)} />
                    <SummaryMetric label="Chance" value={pct(evaluation.probabilityExperimental, 1)} />
                    <SummaryMetric label="Retorno" value={pct(evaluation.evCons, 1)} highlight />
                  </div>
                </div>
              </div>
              <CollapsiblePanel className="m-3 mt-0 bg-transparent shadow-none sm:m-4 sm:mt-0" title="Ver análise completa" description="Preço de referência, vantagem e base usada">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <MetricTile label="Odd de referência" value={dec(evaluation.fairOdd)} />
                  <MetricTile label="Odd mínima" value={dec(evaluation.minOddTarget)} />
                  <MetricTile label="Vantagem" value={pct(evaluation.edgeCons)} />
                  <MetricTile label="Jogos usados" value={`${evaluation.sampleSize} time · ${evaluation.trainingMatches} liga`} />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Análise: {friendlyStatus(data.modelStatus)} · Teste: {friendlyStatus(data.productionStatus)} · Referência: <span className="num">{evaluation.predictionId}</span></p>
              </CollapsiblePanel>
            </article>
          ))}
        </div>

        {directionAssessments.length > 0 && (
          <CollapsiblePanel className="mt-4" title="Direção e linhas de referência" description="Compara Mais x Menos nas linhas cotadas e mostra até onde vale pesquisar preço" meta={directionAssessments.length}>
            <div className="divide-y divide-border">
              {directionAssessments.map((assessment) => {
                const matchLabel = data.evaluations.find((evaluation) => evaluation.matchId === assessment.matchId)?.matchLabel ?? "—";
                return (
                  <div key={`${assessment.matchId}-${assessment.market}-${assessment.participant ?? "MATCH"}`} className="py-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div><p className="text-sm font-medium">{matchLabel}</p><p className="text-xs text-muted-foreground">{directionMarketLabel(assessment)} · linha {line(assessment.anchorLine)}</p></div>
                      <span className="text-xs font-medium text-accent">{directionLabel(assessment.direction)}</span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">Chance do modelo: Mais {pct(assessment.overProbability, 1)} · Menos {pct(assessment.underProbability, 1)}</p>
                    {assessment.referenceAlternatives.length > 0 && (
                      <div className="mt-3 rounded-lg border border-border p-3">
                        <p className="text-xs font-medium">Linhas que ainda merecem cotação</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">São referências estatísticas. Só existe value depois de informar uma odd real da casa.</p>
                        <ul className="mt-2 divide-y divide-border/70">
                          {assessment.referenceAlternatives.map((alternative) => (
                            <li key={`${alternative.side}-${alternative.lineCanonical}`} className="py-2 text-xs sm:grid sm:grid-cols-[1fr_auto_auto_auto] sm:gap-3">
                              <span>{alternative.side === "OVER" ? "Mais de" : "Menos de"} {line(alternative.lineCanonical)}</span>
                              <span className="text-muted-foreground">chance {pct(alternative.probabilityExperimental, 1)}</span>
                              <span className="text-muted-foreground">odd justa {dec(alternative.fairOdd)}</span>
                              <span className="text-muted-foreground">cotaria a partir de {dec(alternative.minOddTarget)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CollapsiblePanel>
        )}

        <CollapsiblePanel className="mt-4" title="Outras odds conferidas" description="Boas alternativas e opções que não compensaram" meta={rejected.length}>
          {qualifiedAlternates.length > 0 && (
            <CollapsiblePanel title="Boas opções que ficaram fora" description="Passaram pelos critérios, mas ficaram fora do limite da rodada" meta={qualifiedAlternates.length}>
              <ul className="divide-y divide-border">
                {qualifiedAlternates.map((evaluation) => {
                  const promoted = promotedIds.has(evaluation.predictionId);
                  return (
                    <li key={evaluation.predictionId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div><p className="text-sm font-medium">{evaluation.matchLabel}</p><p className="text-xs text-muted-foreground">{evaluation.marketLabel} · odd {dec(evaluation.odd)} · retorno {pct(evaluation.evCons, 1)}</p></div>
                      <Button type="button" size="sm" variant={promoted ? "secondary" : "outline"} disabled={promoted || promotingId !== null} onClick={() => void selectAlternate(evaluation)}>
                        {promoted ? "Escolhida" : promotingId === evaluation.predictionId ? "Escolhendo…" : "Escolher"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </CollapsiblePanel>
          )}
          <CollapsiblePanel className={qualifiedAlternates.length > 0 ? "mt-3" : ""} title="Opções que não compensaram" meta={withoutValue.length}>
            <ul className="divide-y divide-border">
              {withoutValue.map((evaluation) => (
                <li key={evaluation.predictionId} className="py-3 text-sm sm:grid sm:grid-cols-[1fr_1fr_auto] sm:gap-3"><span>{evaluation.matchLabel}</span><span className="mt-1 block text-muted-foreground sm:mt-0">{evaluation.marketLabel} · odd {dec(evaluation.odd)}</span><span className="mt-1 block text-xs text-warning sm:mt-0">{friendlyReason(evaluation.rejectionReason)}</span></li>
              ))}
            </ul>
          </CollapsiblePanel>
        </CollapsiblePanel>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row"><Button asChild variant="outline"><Link to="/run/$runId/oportunidades" params={{ runId }}>Voltar às opções</Link></Button><Button asChild variant="outline"><Link to="/">Nova análise</Link></Button><Button asChild><Link to="/analytics">Ver desempenho</Link></Button></div>
      </div>
    </AppShell>
  );
}

function SummaryMetric({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return <div><p className="text-[10px] text-muted-foreground">{label}</p><p className={`num mt-1 text-base font-semibold ${highlight ? "text-success" : ""}`}>{value}</p></div>;
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return <div className="metric-tile p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="num mt-1 text-sm font-medium text-foreground">{value}</p></div>;
}
