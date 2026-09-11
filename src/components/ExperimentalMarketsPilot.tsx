import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Info, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getRun } from "@/lib/analysis.functions";
import { collectAutomaticBet365Odds } from "@/lib/auto-bet365-odds.functions";
import { passesExperimentalModelGate } from "@/lib/engine/market-policy";
import { analyzeExperimentalMarketsOddsPersisted } from "@/lib/experimental-analysis.functions";
import { prepareExperimentalMarketsRun } from "@/lib/experimental-markets-run.functions";

const pct = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(digits)}%`;
const dec = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : Number(value).toFixed(2);

const FAMILY_ORDER = ["CORNERS", "CARDS", "GOALS", "1X2", "DOUBLE_CHANCE"] as const;
const FAMILY_LABELS: Record<string, string> = {
  CORNERS: "Escanteios",
  CARDS: "Cartões",
  GOALS: "Gols",
  "1X2": "Resultado",
  DOUBLE_CHANCE: "Dupla chance",
};

type AutoQuote = {
  predictionId: string;
  status: "MATCHED" | "LINE_MISMATCH" | "UNSUPPORTED" | "NO_PRICE" | "SOURCE_UNAVAILABLE";
  odd: number | null;
  offeredLine: number | null;
  stage: "closing" | "opening" | null;
  reason: string;
};

function selectionLimitForDate(isoDate: string | null | undefined) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return 2;
  const [year, month, day] = isoDate.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return weekday === 0 || weekday === 6 ? 3 : 2;
}

export function fallbackEligiblePredictionIds(
  candidates: Array<{ predictionId: string; probabilityExperimental: number }>,
) {
  return candidates
    .filter((candidate) => passesExperimentalModelGate(candidate.probabilityExperimental))
    .map((candidate) => candidate.predictionId);
}

function fallbackBatches(ids: string[], size = 12) {
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += size) batches.push(ids.slice(index, index + size));
  return batches;
}

export function ExperimentalMarketsPilot({ runId }: { runId: string }) {
  const navigate = useNavigate();
  const prepare = useServerFn(prepareExperimentalMarketsRun);
  const analyze = useServerFn(analyzeExperimentalMarketsOddsPersisted);
  const collectAutoOdds = useServerFn(collectAutomaticBet365Odds);
  const fetchRun = useServerFn(getRun);
  const [odds, setOdds] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [autoOddsLoading, setAutoOddsLoading] = useState(false);
  const [autoQuotes, setAutoQuotes] = useState<Record<string, AutoQuote>>({});
  const [manualBatches, setManualBatches] = useState<string[][]>([]);
  const [visibleBatchCount, setVisibleBatchCount] = useState(1);
  const [autoSummary, setAutoSummary] = useState<{
    matched: number;
    lineMismatch: number;
    unsupported: number;
    noPrice: number;
    sourceUnavailable: number;
    manualFieldCount: number;
  } | null>(null);
  const autoStartedForRun = useRef<string | null>(null);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch: refetchPreparation,
  } = useQuery({
    queryKey: ["experimental-markets-run", runId],
    queryFn: () => prepare({ data: { runId } }),
    staleTime: 5 * 60 * 1000,
  });

  const { data: runData } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => fetchRun({ data: { runId } }),
    staleTime: 5 * 60 * 1000,
  });

  const eligible = useMemo(() => data?.candidates ?? [], [data]);

  useEffect(() => {
    setVisibleBatchCount(1);
    setManualBatches([]);
    setAutoQuotes({});
    setAutoSummary(null);
    setOdds({});
    autoStartedForRun.current = null;
  }, [runId]);

  useEffect(() => {
    if (eligible.length === 0 || autoStartedForRun.current === runId) return;
    autoStartedForRun.current = runId;
    let cancelled = false;

    async function runAutomaticOdds() {
      setAutoOddsLoading(true);
      try {
        const result = await collectAutoOdds({ data: { runId } });
        if (cancelled) return;
        const byPrediction: Record<string, AutoQuote> = {};
        const automaticValues: Record<string, string> = {};
        for (const quote of result.quotes) {
          byPrediction[quote.predictionId] = quote as AutoQuote;
          if (quote.status === "MATCHED" && quote.odd !== null && quote.odd > 1) {
            automaticValues[quote.predictionId] = String(quote.odd);
          }
        }
        setAutoQuotes(byPrediction);
        setManualBatches(result.manualBatches ?? []);
        setAutoSummary({
          matched: result.matched,
          lineMismatch: result.lineMismatch,
          unsupported: result.unsupported,
          noPrice: result.noPrice,
          sourceUnavailable: result.sourceUnavailable,
          manualFieldCount: result.manualFieldCount ?? 0,
        });
        setOdds((current) => ({ ...current, ...automaticValues }));
      } catch {
        if (!cancelled) {
          setManualBatches(fallbackBatches(fallbackEligiblePredictionIds(eligible)));
          toast.error("A busca automática falhou. Apenas opções com chance do modelo >70% seguem para odds manuais.");
        }
      } finally {
        if (!cancelled) setAutoOddsLoading(false);
      }
    }

    void runAutomaticOdds();
    return () => {
      cancelled = true;
    };
  }, [collectAutoOdds, eligible, runId]);

  const visibleManualIds = useMemo(
    () => new Set(manualBatches.slice(0, visibleBatchCount).flat()),
    [manualBatches, visibleBatchCount],
  );
  const visibleCandidates = useMemo(
    () => eligible.filter((candidate) => visibleManualIds.has(candidate.predictionId)),
    [eligible, visibleManualIds],
  );
  const automaticCandidates = useMemo(
    () =>
      eligible.flatMap((candidate) => {
        const quote = autoQuotes[candidate.predictionId];
        if (quote?.status !== "MATCHED" || quote.odd === null || quote.odd <= 1) return [];
        return [{ candidate, quote }];
      }),
    [autoQuotes, eligible],
  );
  const remainingManual = Math.max(
    0,
    manualBatches.slice(visibleBatchCount).reduce((sum, batch) => sum + batch.length, 0),
  );

  const groupedByMatch = useMemo(() => {
    const groups = new Map<string, { matchId: string; matchLabel: string; competition: string; rows: typeof visibleCandidates }>();
    for (const candidate of visibleCandidates) {
      const current = groups.get(candidate.matchId) ?? {
        matchId: candidate.matchId,
        matchLabel: candidate.matchLabel,
        competition: candidate.competition,
        rows: [],
      };
      current.rows.push(candidate);
      groups.set(candidate.matchId, current);
    }
    return [...groups.values()].map((group) => ({
      ...group,
      rows: [...group.rows].sort((a, b) => {
        const familyA = FAMILY_ORDER.indexOf(a.family as (typeof FAMILY_ORDER)[number]);
        const familyB = FAMILY_ORDER.indexOf(b.family as (typeof FAMILY_ORDER)[number]);
        if (familyA !== familyB) return familyA - familyB;
        return a.marketLabel.localeCompare(b.marketLabel, "pt-BR");
      }),
    }));
  }, [visibleCandidates]);

  async function evaluate() {
    const entries = eligible
      .map((candidate) => ({
        predictionId: candidate.predictionId,
        odd: Number((odds[candidate.predictionId] ?? "").replace(",", ".")),
        lineAtEntry: candidate.lineCanonical,
      }))
      .filter((entry) => Number.isFinite(entry.odd) && entry.odd > 1);

    if (entries.length === 0) {
      toast.error("Nenhuma odd válida disponível para comparar.");
      return;
    }

    setSubmitting(true);
    try {
      const evaluated = await analyze({ data: { runId, entries } });
      const targetDate = evaluated.targetDate ?? runData?.run?.target_date ?? data?.predictionAt?.slice(0, 10) ?? null;
      const selectionLimit = evaluated.selectionLimit ?? selectionLimitForDate(targetDate);
      const limitedSelections = evaluated.selections;
      const selectedIds = new Set(limitedSelections.map((selection) => selection.predictionId));
      const candidateByPrediction = new Map(eligible.map((candidate) => [candidate.predictionId, candidate]));
      const enrichedEvaluations = evaluated.evaluations.map((evaluation) => {
        const candidate = candidateByPrediction.get(evaluation.predictionId);
        return {
          ...evaluation,
          selected: selectedIds.has(evaluation.predictionId),
          matchLabel: candidate?.matchLabel ?? evaluation.matchLabel ?? "—",
          marketLabel: candidate?.marketLabel ?? evaluation.marketLabel,
          competition: candidate?.competition ?? evaluation.competition ?? "",
          family: candidate?.family ?? evaluation.family,
          modelVersion: candidate?.modelVersion ?? evaluation.modelVersion,
          sampleSize: candidate?.sampleSize ?? evaluation.sampleSize ?? 0,
          trainingMatches: candidate?.trainingMatches ?? evaluation.trainingMatches ?? 0,
          lineCanonical: candidate?.lineCanonical ?? evaluation.lineCanonical ?? null,
        };
      });
      localStorage.setItem(
        `experimental-result:${runId}`,
        JSON.stringify({
          runId,
          analyzedAt: evaluated.analyzedAt ?? new Date().toISOString(),
          targetDate,
          dayType: selectionLimit === 3 ? "WEEKEND" : "WEEKDAY",
          selectionLimit,
          modelStatus: evaluated.modelStatus,
          productionStatus: evaluated.productionStatus,
          evaluations: enrichedEvaluations,
          selectionOrder: limitedSelections.map((selection) => selection.predictionId),
          directionAssessments: evaluated.directionAssessments,
          referenceAlternatives: evaluated.referenceAlternatives,
          correlatedAlternates: evaluated.correlatedAlternates ?? [],
        }),
      );
      navigate({ to: "/run/$runId/resultado", params: { runId }, search: { mode: "experimental" } });
    } catch {
      toast.error("Não foi possível comparar as odds agora. Tente novamente.");
      setSubmitting(false);
    }
  }

  const targetDate = runData?.run?.target_date ?? data?.predictionAt?.slice(0, 10) ?? null;
  const selectionLimit = selectionLimitForDate(targetDate);

  if (isError) {
    return (
      <section className="panel mt-4 border-destructive/30 p-5">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Não foi possível preparar as opções</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A análise não foi concluída nesta tela. Isso não significa que não existam oportunidades.
            </p>
            {error instanceof Error && <p className="mt-2 text-xs text-destructive">{error.message}</p>}
            <Button className="mt-4 min-h-11" variant="outline" onClick={() => void refetchPreparation()}>
              Tentar novamente
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel mt-4 overflow-hidden border-warning/30">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-warning/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-warning">Modelo em validação</span>
            <span className="text-xs text-muted-foreground">até {selectionLimit} sugestão(ões)</span>
          </div>
          <h2 className="mt-2 text-lg font-semibold">Cotação em etapas</h2>
          <p className="mt-1 text-xs text-muted-foreground">A API é usada primeiro; você só preenche o que ficou sem preço automático.</p>
        </div>
        {autoOddsLoading ? (
          <span className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Buscando odds</span>
        ) : autoSummary ? (
          <span className="text-xs text-muted-foreground">{autoSummary.matched} automática(s) · {visibleCandidates.length} manual(is) neste lote</span>
        ) : null}
      </div>

      <CollapsiblePanel className="m-4 mb-0 border-warning/20 bg-transparent shadow-none sm:m-5 sm:mb-0" title="Como funciona" description="Preço automático primeiro, lotes manuais depois">
        <p className="text-sm text-muted-foreground">O sistema calcula as linhas centrais, tenta obter o preço real da Bet365 e retira da fila manual tudo que conseguiu preencher sozinho. O restante é priorizado apenas para organizar o trabalho — não é um corte de value.</p>
        {autoSummary && <p className="mt-2 text-xs text-muted-foreground">{autoSummary.matched} automáticas · {autoSummary.manualFieldCount} manuais no total · {autoSummary.lineMismatch} com linha diferente · {autoSummary.unsupported} sem contrato direto na API · {autoSummary.noPrice} sem preço.</p>}
      </CollapsiblePanel>

      {isLoading || autoOddsLoading ? (
        <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Organizando as cotações…</div>
      ) : eligible.length === 0 ? (
        <div className="p-5 text-sm text-muted-foreground">Nenhuma linha pôde ser modelada com os dados disponíveis nesta rodada.</div>
      ) : (
        <>
          {automaticCandidates.length > 0 && (
            <CollapsiblePanel
              className="m-4 mb-0 bg-transparent shadow-none sm:m-5 sm:mb-0"
              title="Odds encontradas automaticamente"
              description="Confira os preços que serão incluídos quando você analisar as odds disponíveis"
              meta={automaticCandidates.length}
              defaultOpen
            >
              <ul className="divide-y divide-border">
                {automaticCandidates.map(({ candidate, quote }) => (
                  <li key={candidate.predictionId} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{candidate.matchLabel}</p>
                      <p className="text-xs text-muted-foreground">{candidate.marketLabel}</p>
                    </div>
                    <div className="shrink-0 sm:text-right">
                      <p className="num text-sm font-semibold">odd {dec(quote.odd)}</p>
                      <p className="text-[11px] text-muted-foreground">Bet365 · preenchida automaticamente</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CollapsiblePanel>
          )}

          {visibleCandidates.length === 0 ? (
            <div className="p-5 text-sm text-muted-foreground">Não há odd manual neste lote. As odds disponíveis acima já foram preenchidas automaticamente.</div>
          ) : (
            <div className="divide-y divide-border/70">
              {groupedByMatch.map((group) => (
                <article key={group.matchId} className="px-4 py-4 sm:px-5">
                  <div className="mb-3"><h3 className="text-sm font-semibold sm:text-base">{group.matchLabel}</h3><p className="mt-0.5 text-xs text-muted-foreground">{group.competition}</p></div>
                  <div className="overflow-hidden rounded-lg border border-border">
                    <div className="divide-y divide-border/70">
                      {group.rows.map((candidate) => {
                        const quote = autoQuotes[candidate.predictionId];
                        const isOpen = Boolean(details[candidate.predictionId]);
                        return (
                          <div key={candidate.predictionId} className="grid gap-3 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:p-4">
                            <div>
                              <p className="text-sm font-medium">{candidate.marketLabel}</p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">{FAMILY_LABELS[candidate.family] ?? candidate.family} · chance {pct(candidate.probabilityExperimental)}</p>
                              {quote?.status === "LINE_MISMATCH" && <p className="mt-1 text-[10px] text-warning">A Bet365 está em {quote.offeredLine ?? "—"}; confira a odd manualmente.</p>}
                              {isOpen && <p className="mt-2 text-xs text-muted-foreground">Odd justa {dec(candidate.fairOddExperimental)} · {candidate.sampleSize} jogos do time · {candidate.trainingMatches} da liga</p>}
                            </div>
                            <label className="text-[11px] text-muted-foreground">Odd bet365<Input inputMode="decimal" value={odds[candidate.predictionId] ?? ""} onChange={(event) => setOdds((current) => ({ ...current, [candidate.predictionId]: event.target.value }))} className="num mt-1 w-28" aria-label={`Odd bet365 para ${group.matchLabel} — ${candidate.marketLabel}`} /></label>
                            <button type="button" onClick={() => setDetails((current) => ({ ...current, [candidate.predictionId]: !isOpen }))} className="inline-flex min-h-10 items-center gap-1 text-xs text-accent"><Info className="size-3" /> {isOpen ? "Ocultar" : "Detalhes"}</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="border-t border-border p-4 sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button className="min-h-11" onClick={() => void evaluate()} disabled={submitting}>
                {submitting ? "Analisando…" : "ANALISAR ODDS DISPONÍVEIS"}
              </Button>
              {remainingManual > 0 && (
                <Button type="button" variant="outline" className="min-h-11" onClick={() => setVisibleBatchCount((count) => Math.min(manualBatches.length, count + 1))}>
                  MOSTRAR PRÓXIMO LOTE ({remainingManual} restantes)
                </Button>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">A análise inclui as odds automáticas e todas as odds manuais válidas que você preencheu até aqui.</p>
          </div>
        </>
      )}
    </section>
  );
}