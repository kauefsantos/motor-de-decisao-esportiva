import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Info, Loader2, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { MetricHelp } from "@/components/MetricHelp";
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
  if (!quote) {
    return "A cotação automática não ficou disponível. Consulte a Bet365 e informe manualmente somente a odd do mesmo mercado, lado e linha mostrados.";
  }
  if (quote.status === "UNSUPPORTED") {
    return "A API não fornece este contrato automaticamente. Consulte a Bet365 e informe manualmente a odd do mesmo mercado, lado e linha.";
  }
  if (quote.status === "LINE_MISMATCH") {
    return "A linha encontrada pela API é diferente da linha analisada. Não use essa cotação; informe manualmente somente a odd da linha exata mostrada aqui.";
  }
  if (quote.status === "NO_PRICE") {
    return "A Bet365 não trouxe preço automático para este contrato. Se a mesma linha estiver disponível no site, informe a odd manualmente.";
  }
  if (quote.status === "SOURCE_UNAVAILABLE") {
    return "A consulta automática ficou indisponível. Informe a odd manualmente somente se confirmar o mesmo contrato diretamente na Bet365.";
  }
  return null;
}

export function DecisionQueueFlow({ runId }: { runId: string }) {
  const navigate = useNavigate();
  const prepare = useServerFn(prepareExperimentalMarketsRun);
  const collectAutoOdds = useServerFn(collectAutomaticBet365Odds);
  const buildQueue = useServerFn(buildDecisionOpportunityQueue);
  const loadHistory = useServerFn(getDecisionQueueHistory);

  const [odds, setOdds] = useState<Record<string, string>>({});
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
          toast.error(error instanceof Error ? error.message : "Não foi possível buscar todas as odds automaticamente. Você pode preencher as que faltaram.");
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
    const entries = eligible
      .map((candidate) => ({
        predictionId: candidate.predictionId,
        odd: Number((odds[candidate.predictionId] ?? "").replace(",", ".")),
        lineAtEntry: candidate.lineCanonical,
      }))
      .filter((entry) => Number.isFinite(entry.odd) && entry.odd > 1);

    if (entries.length === 0) {
      toast.error("Nenhuma odd válida está disponível para avaliar. Preencha ao menos uma odd para continuar.");
      return;
    }

    setBuilding(true);
    try {
      const result = await buildQueue({ data: { runId, entries } });
      setEmptyQueueMessage(result.data.totalQualified === 0 ? result.data.message : null);
      await historyQuery.refetch();
      toast.success(
        result.data.totalQualified === 0
          ? "Avaliação concluída: nenhuma opção passou por todos os critérios."
          : `${result.data.totalQualified} opção${result.data.totalQualified === 1 ? "" : "ões"} com valor encontrada${result.data.totalQualified === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível avaliar as odds. Nada foi alterado.");
    } finally {
      setBuilding(false);
    }
  }

  if (preparationQuery.isError || historyQuery.isError) {
    return (
      <section className="panel mt-4 border-destructive/30 p-5" role="alert">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Não foi possível carregar as opções</h2>
            <p className="mt-1 text-sm text-muted-foreground">Sua análise continua salva. Tente novamente para retomar desta etapa.</p>
            <Button className="mt-4" variant="outline" onClick={() => void Promise.all([preparationQuery.refetch(), historyQuery.refetch()])}>Tentar novamente</Button>
          </div>
        </div>
      </section>
    );
  }

  if (history?.selectionFinalized) {
    return (
      <section className="panel mt-4 p-5">
        <div className="flex items-start gap-3">
          <Check className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <div>
            <h2 className="font-semibold">Escolhas já confirmadas</h2>
            <p className="mt-1 text-sm text-muted-foreground">Você já concluiu esta etapa. Continue para revisar e registrar as apostas.</p>
            <Button className="mt-4" onClick={() => navigate({ to: "/run/$runId/resultado", params: { runId }, search: { mode: "experimental" } })}>Revisar escolhas</Button>
          </div>
        </div>
      </section>
    );
  }

  if (emptyQueueMessage && !queueExists) {
    return (
      <section className="panel mt-4 border-warning/25 p-5" role="status" aria-live="polite">
        <h2 className="font-semibold">Nenhuma opção passou por todos os critérios</h2>
        <p className="mt-1 text-sm text-muted-foreground">{emptyQueueMessage}</p>
        <p className="mt-2 text-xs text-muted-foreground">O sistema não cria sugestões artificiais apenas para preencher a tela.</p>
      </section>
    );
  }

  if (queueExists) {
    return (
      <section className="panel mt-4 overflow-hidden border-primary/20">
        <div className="border-b border-border p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="label-eyebrow">Opções com valor</p>
              <h2 className="mt-1 text-lg font-semibold">Escolha até {dailyLimit} opções para esta rodada</h2>
              <p className="mt-1 text-xs text-muted-foreground">As melhores opções aparecem primeiro. Para proteger sua seleção, você não pode escolher duas opções do mesmo jogo.</p>
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">{acceptedCount}/{dailyLimit} escolhidas</span>
          </div>
        </div>

        {acceptedRows.length > 0 && (
          <div className="border-b border-border/60 px-4 py-3 sm:px-5">
            <p className="text-xs font-medium text-success">Escolhidas</p>
            <ul className="mt-2 divide-y divide-border/60">
              {acceptedRows.map((row) => (
                <li key={row.id} className="py-2 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium">{row.match_label}</p>
                  <p className="text-xs text-muted-foreground">{row.market_label} · odd {formatDecisionDecimal(row.entry_odd)} · EV esperado {formatDecisionPercent(row.expected_value)}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {shown.length > 0 && acceptedCount < dailyLimit && (
          <div className="divide-y divide-border/70">
            {shown.map((row) => (
              <article key={row.id} className="p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">#{row.rank_global} · {row.competition ?? "Competição"} · {DECISION_FAMILY_LABELS[row.market_family] ?? row.market_family}</p>
                    <h3 className="mt-1 text-base font-semibold">{row.match_label}</h3>
                    <p className="text-sm text-muted-foreground">{row.market_label}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Odd <span className="num text-foreground">{formatDecisionDecimal(row.entry_odd)}</span></span>
                      <span>Chance <span className="num text-foreground">{formatDecisionPercent(row.model_probability)}</span></span>
                      <span className="inline-flex items-center">EV esperado <MetricHelp term="EV" /> <span className="num ml-1 text-success">{formatDecisionPercent(row.expected_value)}</span></span>
                      <span className="inline-flex items-center">Vantagem <MetricHelp term="Vantagem" /> <span className="num ml-1 text-foreground">{formatDecisionPercent(row.edge)}</span></span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" className="min-h-11" disabled={actions.actionId !== null} onClick={() => void actions.declineRow(row.id)}><X className="mr-1 size-4" aria-hidden /> Recusar</Button>
                    <Button className="min-h-11" disabled={actions.actionId !== null || acceptedCount >= dailyLimit} onClick={() => void actions.acceptRow(row.id)}><Check className="mr-1 size-4" aria-hidden /> Escolher</Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {shown.length === 0 && !exhausted && acceptedCount < dailyLimit && (
          <div className="p-5"><p className="text-sm text-muted-foreground">Você terminou este grupo. Ainda existem outras opções qualificadas.</p><Button className="mt-3" variant="outline" onClick={() => void actions.nextBatch()}>Mostrar mais opções</Button></div>
        )}

        {exhausted && acceptedCount === 0 && (
          <div className="p-5"><p className="font-medium">Nenhuma opção qualificada restou nesta rodada.</p><p className="mt-1 text-sm text-muted-foreground">Não escolher também é uma decisão válida; nenhuma recomendação artificial será criada.</p></div>
        )}

        {canFinalize && (
          <div className="border-t border-border p-4 sm:p-5">
            <Button className="min-h-12 w-full sm:w-auto" disabled={actions.finalizing} onClick={() => void actions.finalizeChoices()}>{actions.finalizing ? "Salvando escolhas…" : `Revisar ${acceptedCount} escolha${acceptedCount === 1 ? "" : "s"}`}</Button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="panel mt-4 overflow-hidden border-warning/30">
      <div className="border-b border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="label-eyebrow">Conferir preços</p>
            <h2 className="mt-1 text-lg font-semibold">Conferir as odds reais</h2>
            <p className="mt-1 text-xs text-muted-foreground">Buscamos a Bet365 automaticamente quando há um preço compatível. Mercados que a API não expõe diretamente — como dupla chance e alguns totais por equipe — continuam disponíveis para você informar a odd manualmente.</p>
          </div>
          {autoLoading && <span className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite"><Loader2 className="size-3.5 animate-spin" aria-hidden /> Buscando odds</span>}
        </div>
      </div>

      {preparationQuery.isLoading || autoLoading ? (
        <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground" role="status" aria-live="polite"><Loader2 className="size-4 animate-spin" aria-hidden /> Organizando as cotações…</div>
      ) : eligible.length === 0 ? (
        <div className="p-5 text-sm text-muted-foreground">Nenhuma opção pôde ser calculada com segurança com os dados disponíveis nesta rodada.</div>
      ) : (
        <>
          {automaticCandidates.length > 0 && (
            <div className="border-b border-border/60 px-4 py-3 sm:px-5">
              <p className="text-xs font-medium">Odds encontradas automaticamente</p>
              <ul className="mt-2 divide-y divide-border/60">
                {automaticCandidates.map((candidate) => {
                  const quote = autoQuotes[candidate.predictionId];
                  return (
                    <li key={candidate.predictionId} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                      <div><p className="text-sm font-medium">{candidate.matchLabel}</p><p className="text-xs text-muted-foreground">{candidate.marketLabel}</p></div>
                      <div className="sm:text-right"><p className="num text-sm font-semibold">odd {formatDecisionDecimal(quote?.odd)}</p><p className="type-caption text-muted-foreground">Bet365 · automática</p></div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {manualCandidates.length > 0 && (
            <div>
              <div className="border-b border-border/60 bg-muted/20 px-4 py-3 sm:px-5">
                <p className="text-xs font-semibold">Odds que precisam de conferência manual</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Informe somente a odd da Bet365 para o mesmo mercado, lado e linha exibidos. A entrada manual não relaxa nenhuma regra: o motor ainda exige chance ≥70%, odd ≥1,70, EV ≥8% e vantagem ≥5 p.p.</p>
              </div>
              <div className="divide-y divide-border/70">
                {manualCandidates.map((candidate) => {
                  const open = Boolean(details[candidate.predictionId]);
                  const quote = autoQuotes[candidate.predictionId];
                  const guidance = manualQuoteGuidance(quote);
                  const detailId = `decision-detail-${candidate.predictionId}`;
                  const guidanceId = `decision-guidance-${candidate.predictionId}`;
                  return (
                    <div key={candidate.predictionId} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:p-5">
                      <div>
                        <p className="text-sm font-medium">{candidate.matchLabel}</p>
                        <p className="text-xs text-muted-foreground">{candidate.marketLabel} · chance {formatDecisionPercent(candidate.probabilityExperimental)}</p>
                        {guidance && <p id={guidanceId} className={`mt-1 text-xs ${quote?.status === "LINE_MISMATCH" ? "text-warning" : "text-muted-foreground"}`}>{guidance}</p>}
                        {open && <p id={detailId} className="mt-2 text-xs text-muted-foreground">Odd de referência {formatDecisionDecimal(candidate.fairOddExperimental)} · linha {candidate.lineCanonical ?? "—"}</p>}
                      </div>
                      <label className="text-sm text-muted-foreground">Odd Bet365 manual
                        <Input
                          inputMode="decimal"
                          placeholder="Ex.: 1,85"
                          aria-describedby={guidance ? guidanceId : undefined}
                          value={odds[candidate.predictionId] ?? ""}
                          onChange={(event) => setOdds((current) => ({ ...current, [candidate.predictionId]: event.target.value }))}
                          className="num mt-1 w-28"
                        />
                      </label>
                      <button type="button" className="touch-target inline-flex min-h-10 items-center gap-1 text-xs text-accent" aria-expanded={open} aria-controls={detailId} onClick={() => setDetails((current) => ({ ...current, [candidate.predictionId]: !open }))}><Info className="size-3" aria-hidden /> {open ? "Ocultar detalhes" : "Ver detalhes"}</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="border-t border-border p-4 sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="min-h-12" disabled={building} onClick={() => void createDecisionQueue()}>{building ? "Avaliando…" : "Ver opções com valor"}</Button>
              {remainingManual > 0 && <Button variant="outline" className="min-h-12" onClick={() => setVisibleBatchCount((count) => Math.min(manualBatches.length, count + 1))}>Mostrar mais odds manuais ({remainingManual})</Button>}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Pode haver menos de 10 opções ou nenhuma. Só avançam as que passam por todos os critérios da análise.</p>
          </div>

          <CollapsiblePanel className="mx-4 mb-4 bg-transparent shadow-none sm:mx-5 sm:mb-5" title="Detalhes técnicos desta etapa" description="Cache, limites de consulta e critérios de proteção">
            <p className="text-xs leading-relaxed text-muted-foreground">As consultas externas, cache, limites compartilhados e novas tentativas são controlados no processamento central. Quando a API não possui o contrato ou a linha exata, a odd pode ser informada manualmente, mas continua sendo avaliada pelo mesmo motor de valor e pelas mesmas travas. Recarregar a página não deve repetir uma avaliação já salva.</p>
          </CollapsiblePanel>
        </>
      )}
    </section>
  );
}
