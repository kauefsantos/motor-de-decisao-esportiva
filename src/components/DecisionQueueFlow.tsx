import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, Info, Loader2, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDecisionQueueActions } from "@/hooks/useDecisionQueueActions";
import {
  DECISION_FAMILY_LABELS,
  fallbackDecisionBatches,
  formatDecisionDecimal,
  formatDecisionPercent,
  type DecisionQueueHistory,
  type DecisionQueueRow,
} from "@/lib/application/decision-queue/view-model";
import { collectAutomaticBet365Odds } from "@/lib/auto-bet365-odds.functions";
import { buildDecisionOpportunityQueue, getDecisionQueueHistory } from "@/lib/decision-queue.functions";
import { buildConfirmedQuoteEntries } from "@/lib/engine/quote-confirmation";
import { prepareExperimentalMarketsRun } from "@/lib/experimental-markets-run.functions";

type AutoQuote = {
  predictionId: string;
  status: "MATCHED" | "LINE_MISMATCH" | "UNSUPPORTED" | "NO_PRICE" | "SOURCE_UNAVAILABLE";
  odd: number | null;
  offeredLine: number | null;
  stage: "closing" | "opening" | null;
  reason: string;
};

function manualQuoteGuidance(quote: AutoQuote | undefined) {
  if (!quote) return "Não conseguimos buscar esta odd automaticamente. Confira a mesma opção na Bet365.";
  if (quote.status === "UNSUPPORTED") return "Esta opção precisa ser conferida diretamente na Bet365.";
  if (quote.status === "LINE_MISMATCH") return "A linha encontrada é diferente. Digite apenas a odd da linha exata mostrada aqui.";
  if (quote.status === "NO_PRICE") return "A Bet365 não trouxe uma odd automática para esta opção.";
  if (quote.status === "SOURCE_UNAVAILABLE") return "A consulta automática ficou indisponível. Você pode informar a odd manualmente.";
  return null;
}

export function DecisionQueueFlow({ runId }: { runId: string }) {
  const navigate = useNavigate();
  const prepare = useServerFn(prepareExperimentalMarketsRun);
  const collectAutoOdds = useServerFn(collectAutomaticBet365Odds);
  const buildQueue = useServerFn(buildDecisionOpportunityQueue);
  const loadHistory = useServerFn(getDecisionQueueHistory);

  const [odds, setOdds] = useState<Record<string, string>>({});
  const [manualEditedIds, setManualEditedIds] = useState<Set<string>>(() => new Set());
  const [autoQuotes, setAutoQuotes] = useState<Record<string, AutoQuote>>({});
  const [manualBatches, setManualBatches] = useState<string[][]>([]);
  const [visibleBatchCount, setVisibleBatchCount] = useState(1);
  const [autoLoading, setAutoLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [details, setDetails] = useState<Record<string, boolean>>({});
  const [emptyQueueMessage, setEmptyQueueMessage] = useState<string | null>(null);
  const autoStartedForRun = useRef<string | null>(null);

  const preparationQuery = useQuery({
    queryKey: ["experimental-markets-run", runId],
    queryFn: () => prepare({ data: { runId } }),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const historyQuery = useQuery({
    queryKey: ["decision-queue-history", runId],
    queryFn: async () => (await loadHistory({ data: { runId } })).data as DecisionQueueHistory,
    staleTime: 0,
    retry: 1,
  });
  const actions = useDecisionQueueActions(runId, async () => {
    const result = await historyQuery.refetch();
    return { data: result.data };
  });

  const eligible = useMemo(() => preparationQuery.data?.candidates ?? [], [preparationQuery.data]);
  const history = historyQuery.data;
  const queueRows = (history?.rows ?? []) as DecisionQueueRow[];
  const queueExists = queueRows.length > 0 || Boolean(history?.selectionFinalized);

  useEffect(() => {
    setOdds({});
    setManualEditedIds(new Set());
    setAutoQuotes({});
    setManualBatches([]);
    setVisibleBatchCount(1);
    setDetails({});
    setEmptyQueueMessage(null);
    autoStartedForRun.current = null;
  }, [runId]);

  useEffect(() => {
    if (queueExists || eligible.length === 0 || autoStartedForRun.current === runId) return;
    autoStartedForRun.current = runId;
    let cancelled = false;

    async function collect() {
      setAutoLoading(true);
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
        setOdds(automaticValues);
      } catch (error) {
        if (!cancelled) {
          setManualBatches(fallbackDecisionBatches(eligible));
          toast.error(error instanceof Error ? error.message : "Não foi possível buscar todas as odds. Você pode preencher as que faltaram.");
        }
      } finally {
        if (!cancelled) setAutoLoading(false);
      }
    }

    void collect();
    return () => { cancelled = true; };
  }, [collectAutoOdds, eligible, queueExists, runId]);

  const visibleManualIds = useMemo(() => new Set(manualBatches.slice(0, visibleBatchCount).flat()), [manualBatches, visibleBatchCount]);
  const manualCandidates = useMemo(() => eligible.filter((candidate) => visibleManualIds.has(candidate.predictionId)), [eligible, visibleManualIds]);
  const automaticCandidates = useMemo(() => eligible.filter((candidate) => autoQuotes[candidate.predictionId]?.status === "MATCHED"), [autoQuotes, eligible]);
  const remainingManual = manualBatches.slice(visibleBatchCount).reduce((sum, batch) => sum + batch.length, 0);

  const shown = queueRows.filter((row) => row.queue_state === "SHOWN");
  const acceptedRows = queueRows.filter((row) => row.queue_state === "ACCEPTED");
  const acceptedCount = history?.acceptedCount ?? acceptedRows.length;
  const dailyLimit = history?.dailySelectionLimit ?? 3;
  const exhausted = Boolean(history?.exhausted);
  const canFinalize = !history?.selectionFinalized && acceptedCount > 0 && (acceptedCount >= dailyLimit || exhausted);

  async function createDecisionQueue() {
    setBuilding(true);
    try {
      const refreshed = await collectAutoOdds({ data: { runId } });
      const refreshedByPrediction: Record<string, AutoQuote> = {};
      const freshAutomaticValues: Record<string, string> = {};
      for (const quote of refreshed.quotes) {
        refreshedByPrediction[quote.predictionId] = quote as AutoQuote;
        if (quote.status === "MATCHED" && quote.odd !== null && quote.odd > 1) {
          freshAutomaticValues[quote.predictionId] = String(quote.odd);
        }
      }

      const manualValues = Object.fromEntries(
        [...manualEditedIds]
          .map((predictionId) => [predictionId, odds[predictionId]] as const)
          .filter((entry): entry is readonly [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0),
      );
      const entries = buildConfirmedQuoteEntries(eligible, refreshed.quotes as AutoQuote[], manualValues);

      setAutoQuotes(refreshedByPrediction);
      setManualBatches(refreshed.manualBatches ?? []);
      setVisibleBatchCount((count) => Math.max(1, Math.min(count, Math.max(1, refreshed.manualBatches?.length ?? 1))));
      setOdds({ ...manualValues, ...freshAutomaticValues });

      if (entries.length === 0) {
        toast.error("Nenhuma odd válida ficou disponível. Confira as odds que ainda precisam ser preenchidas.");
        return;
      }

      const result = await buildQueue({ data: { runId, entries } });
      setEmptyQueueMessage(result.data.totalQualified === 0 ? result.data.message : null);
      await historyQuery.refetch();
      toast.success(
        result.data.totalQualified === 0
          ? "Avaliação concluída: nenhuma opção passou por todos os filtros."
          : `${result.data.totalQualified} opção${result.data.totalQualified === 1 ? "" : "ões"} passou${result.data.totalQualified === 1 ? "" : "ram"} pelos filtros.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar as odds. Nada foi alterado.");
    } finally {
      setBuilding(false);
    }
  }

  if (preparationQuery.isError || historyQuery.isError) {
    return (
      <section className="panel mt-5 border-destructive/30 p-5" role="alert">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Não foi possível carregar esta etapa</h2>
            <p className="mt-1 text-sm text-muted-foreground">Sua análise continua salva. Tente carregar novamente.</p>
            <Button className="mt-4" variant="outline" onClick={() => void Promise.all([preparationQuery.refetch(), historyQuery.refetch()])}>Tentar novamente</Button>
          </div>
        </div>
      </section>
    );
  }

  if (history?.selectionFinalized) {
    return (
      <section className="panel mt-5 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success/10"><Check className="size-5 text-success" aria-hidden /></span>
          <div>
            <h2 className="text-lg font-semibold">Escolhas já salvas</h2>
            <p className="mt-1 text-sm text-muted-foreground">Esta etapa já foi concluída. Você pode seguir para o registro.</p>
            <Button className="mt-4" onClick={() => navigate({ to: "/run/$runId/resultado", params: { runId }, search: { mode: "experimental" } })}>Revisar escolhas</Button>
          </div>
        </div>
      </section>
    );
  }

  if (emptyQueueMessage && !queueExists) {
    return (
      <section className="panel mt-5 overflow-hidden border-success/20" role="status" aria-live="polite">
        <div className="p-5 sm:p-7">
          <span className="flex size-12 items-center justify-center rounded-full bg-success/10"><CheckCircle2 className="size-6 text-success" aria-hidden /></span>
          <p className="label-eyebrow mt-4">Avaliação concluída</p>
          <h2 className="mt-1 text-xl font-semibold">Nenhuma oportunidade nesta rodada</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{emptyQueueMessage}</p>
          <p className="mt-2 text-sm text-muted-foreground">Isso não é erro: nenhuma opção passou por todos os filtros e o sistema não força uma aposta.</p>
        </div>
      </section>
    );
  }

  if (queueExists) {
    return (
      <section className="mt-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="label-eyebrow">Opções encontradas</p>
            <h2 className="mt-1 text-lg font-semibold">Escolha o que quiser acompanhar</h2>
            <p className="mt-1 text-sm text-muted-foreground">Até {dailyLimit} escolhas. Você não precisa preencher o limite.</p>
          </div>
          <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">{acceptedCount}/{dailyLimit} escolhidas</span>
        </div>

        {acceptedRows.length > 0 && (
          <div className="panel mb-3 p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-success">Selecionadas</p>
            <ul className="mt-2 divide-y divide-border/60">
              {acceptedRows.map((row) => (
                <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-semibold">{row.match_label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{row.market_label} · odd {formatDecisionDecimal(row.entry_odd)}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {shown.length > 0 && acceptedCount < dailyLimit && (
          <div className="grid gap-3">
            {shown.map((row) => (
              <article key={row.id} className="panel p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">{row.competition ?? "Competição"} · {DECISION_FAMILY_LABELS[row.market_family] ?? row.market_family}</p>
                    <h3 className="mt-1 text-base font-semibold">{row.match_label}</h3>
                    <p className="mt-1 text-sm text-foreground/80">{row.market_label}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-lg bg-secondary/45 px-2.5 py-1.5 text-xs"><span className="text-muted-foreground">Odd</span> <strong className="num ml-1">{formatDecisionDecimal(row.entry_odd)}</strong></span>
                      <span className="rounded-lg bg-secondary/45 px-2.5 py-1.5 text-xs"><span className="text-muted-foreground">Chance</span> <strong className="num ml-1">{formatDecisionPercent(row.model_probability)}</strong></span>
                    </div>
                    <details className="mt-3 text-xs text-muted-foreground">
                      <summary className="touch-target flex min-h-9 cursor-pointer list-none items-center font-medium text-foreground/80">Ver números da análise</summary>
                      <p>Valor esperado: {formatDecisionPercent(row.expected_value)} · Vantagem: {formatDecisionPercent(row.edge)}</p>
                    </details>
                  </div>
                  <div className="flex shrink-0 gap-2 sm:flex-col">
                    <Button className="min-h-11 flex-1 sm:w-28" disabled={actions.actionId !== null || acceptedCount >= dailyLimit} onClick={() => void actions.acceptRow(row.id)}><Check className="mr-1 size-4" aria-hidden /> Escolher</Button>
                    <Button variant="ghost" className="min-h-11 flex-1 text-muted-foreground sm:w-28" disabled={actions.actionId !== null} onClick={() => void actions.declineRow(row.id)}><X className="mr-1 size-4" aria-hidden /> Descartar</Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {shown.length === 0 && !exhausted && acceptedCount < dailyLimit && (
          <div className="panel p-5"><p className="text-sm text-muted-foreground">Há outras opções qualificadas.</p><Button className="mt-3" variant="outline" onClick={() => void actions.nextBatch()}>Ver próximas opções</Button></div>
        )}

        {exhausted && acceptedCount === 0 && (
          <div className="panel p-5"><p className="font-medium">Não restaram opções qualificadas</p><p className="mt-1 text-sm text-muted-foreground">O sistema não cria recomendações artificiais para preencher o limite.</p></div>
        )}

        {canFinalize && (
          <div className="sticky bottom-[5.2rem] mt-4 rounded-2xl border border-primary/20 bg-background/95 p-3 shadow-lg backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
            <Button className="min-h-12 w-full sm:w-auto" disabled={actions.finalizing} onClick={() => void actions.finalizeChoices()}>{actions.finalizing ? "Salvando…" : `Continuar com ${acceptedCount} escolha${acceptedCount === 1 ? "" : "s"}`}</Button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="mt-5">
      <div className="panel overflow-hidden">
        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="label-eyebrow">Última conferência</p>
              <h2 className="mt-1 text-lg font-semibold">Confira as odds que faltam</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                O sistema já tentou buscar as odds da Bet365. Você só precisa preencher as opções que não foram encontradas automaticamente.
              </p>
            </div>
            {autoLoading && <span className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite"><Loader2 className="size-3.5 animate-spin" aria-hidden /> Atualizando</span>}
          </div>
        </div>

        {preparationQuery.isLoading || autoLoading ? (
          <div className="flex items-center gap-2 border-t border-border/60 p-5 text-sm text-muted-foreground" role="status" aria-live="polite"><Loader2 className="size-4 animate-spin" aria-hidden /> Buscando as odds…</div>
        ) : eligible.length === 0 ? (
          <div className="border-t border-border/60 p-5">
            <h3 className="font-semibold">Nada para conferir</h3>
            <p className="mt-1 text-sm text-muted-foreground">Nenhuma opção pôde ser calculada com segurança nesta rodada.</p>
          </div>
        ) : (
          <>
            {manualCandidates.length > 0 ? (
              <div className="divide-y divide-border/70 border-t border-border/60">
                {manualCandidates.map((candidate) => {
                  const open = Boolean(details[candidate.predictionId]);
                  const quote = autoQuotes[candidate.predictionId];
                  const guidance = manualQuoteGuidance(quote);
                  const detailId = `decision-detail-${candidate.predictionId}`;
                  const guidanceId = `decision-guidance-${candidate.predictionId}`;
                  return (
                    <div key={candidate.predictionId} className="p-4 sm:p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{candidate.matchLabel}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{candidate.marketLabel}</p>
                          {guidance && <p id={guidanceId} className={`mt-1 text-xs ${quote?.status === "LINE_MISMATCH" ? "text-warning" : "text-muted-foreground"}`}>{guidance}</p>}
                        </div>
                        <label className="shrink-0 text-xs font-medium text-foreground">Odd Bet365
                          <Input
                            inputMode="decimal"
                            placeholder="1,85"
                            aria-describedby={guidance ? guidanceId : undefined}
                            value={odds[candidate.predictionId] ?? ""}
                            onChange={(event) => {
                              const value = event.target.value;
                              setOdds((current) => ({ ...current, [candidate.predictionId]: value }));
                              setManualEditedIds((current) => new Set(current).add(candidate.predictionId));
                            }}
                            className="num mt-1 h-11 w-full sm:w-28"
                          />
                        </label>
                      </div>
                      <button type="button" className="touch-target mt-1 inline-flex min-h-9 items-center gap-1 text-xs text-muted-foreground" aria-expanded={open} aria-controls={detailId} onClick={() => setDetails((current) => ({ ...current, [candidate.predictionId]: !open }))}><Info className="size-3" aria-hidden /> {open ? "Ocultar detalhes" : "Por que preciso preencher?"}</button>
                      {open && <div id={detailId} className="rounded-lg bg-secondary/30 p-3 text-xs text-muted-foreground">Chance calculada {formatDecisionPercent(candidate.probabilityExperimental)} · odd de referência {formatDecisionDecimal(candidate.fairOddExperimental)} · linha {candidate.lineCanonical ?? "—"}</div>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="border-t border-border/60 p-5">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
                  <div><h3 className="font-semibold">Odds encontradas automaticamente</h3><p className="mt-1 text-sm text-muted-foreground">Não há nada para preencher. Só falta avaliar as opções com os preços atualizados.</p></div>
                </div>
              </div>
            )}

            <div className="border-t border-border p-4 sm:p-5">
              <Button className="min-h-12 w-full sm:w-auto" disabled={building} onClick={() => void createDecisionQueue()}>{building ? "Avaliando…" : "Avaliar oportunidades"}</Button>
              {remainingManual > 0 && <Button variant="ghost" className="mt-2 min-h-11 w-full sm:ml-2 sm:mt-0 sm:w-auto" onClick={() => setVisibleBatchCount((count) => Math.min(manualBatches.length, count + 1))}>Ver mais odds pendentes ({remainingManual})</Button>}
            </div>
          </>
        )}
      </div>

      <details className="mt-4 rounded-xl border border-border/60 bg-secondary/10 px-4">
        <summary className="touch-target flex min-h-12 cursor-pointer list-none items-center justify-between text-sm font-medium">Detalhes da conferência <span className="text-xs font-normal text-muted-foreground">{automaticCandidates.length} automáticas</span></summary>
        <div className="border-t border-border/60 py-4 text-xs leading-relaxed text-muted-foreground">
          {automaticCandidates.length > 0 && (
            <div className="mb-4">
              <p className="font-medium text-foreground">Odds encontradas automaticamente</p>
              <ul className="mt-2 space-y-2">
                {automaticCandidates.map((candidate) => <li key={candidate.predictionId}>{candidate.matchLabel} · {candidate.marketLabel} · odd {formatDecisionDecimal(autoQuotes[candidate.predictionId]?.odd)}</li>)}
              </ul>
            </div>
          )}
          <p>Ao tocar em “Avaliar oportunidades”, as odds automáticas são consultadas novamente. As probabilidades da análise não são refeitas.</p>
          <p className="mt-2">Uma opção só segue adiante se continuar atendendo aos filtros de probabilidade, odd, valor esperado, vantagem, correlação e limite de escolhas.</p>
        </div>
      </details>
    </section>
  );
}
