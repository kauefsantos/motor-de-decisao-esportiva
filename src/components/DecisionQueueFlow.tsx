import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Info, Loader2, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { collectAutomaticBet365Odds } from "@/lib/auto-bet365-odds.functions";
import {
  acceptDecisionOpportunity,
  buildDecisionOpportunityQueue,
  declineDecisionOpportunity,
  finalizeDecisionSelection,
  getDecisionQueueHistory,
  getNextDecisionBatch,
} from "@/lib/decision-queue.functions";
import { passesExperimentalModelGate } from "@/lib/engine/market-policy";
import { prepareExperimentalMarketsRun } from "@/lib/experimental-markets-run.functions";

const pct = (value: unknown, digits = 1) =>
  value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(digits)}%`;
const dec = (value: unknown) =>
  value === null || value === undefined ? "—" : Number(value).toFixed(2);

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

type QueueRow = {
  id: string;
  queue_state: "AVAILABLE" | "SHOWN" | "ACCEPTED" | "DECLINED";
  rank_global: number;
  match_label: string;
  competition: string | null;
  market_family: string;
  market_label: string;
  model_probability: number | string;
  entry_odd: number | string;
  fair_odd: number | string | null;
  min_odd_target: number | string | null;
  edge: number | string | null;
  expected_value: number | string | null;
};

function fallbackBatches(candidates: Array<{ predictionId: string; probabilityExperimental: number }>, size = 12) {
  const ids = candidates
    .filter((candidate) => passesExperimentalModelGate(candidate.probabilityExperimental))
    .map((candidate) => candidate.predictionId);
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += size) batches.push(ids.slice(index, index + size));
  return batches;
}

export function DecisionQueueFlow({ runId }: { runId: string }) {
  const navigate = useNavigate();
  const prepare = useServerFn(prepareExperimentalMarketsRun);
  const collectAutoOdds = useServerFn(collectAutomaticBet365Odds);
  const buildQueue = useServerFn(buildDecisionOpportunityQueue);
  const loadHistory = useServerFn(getDecisionQueueHistory);
  const loadNextBatch = useServerFn(getNextDecisionBatch);
  const accept = useServerFn(acceptDecisionOpportunity);
  const decline = useServerFn(declineDecisionOpportunity);
  const finalize = useServerFn(finalizeDecisionSelection);

  const [odds, setOdds] = useState<Record<string, string>>({});
  const [autoQuotes, setAutoQuotes] = useState<Record<string, AutoQuote>>({});
  const [manualBatches, setManualBatches] = useState<string[][]>([]);
  const [visibleBatchCount, setVisibleBatchCount] = useState(1);
  const [autoLoading, setAutoLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [queueActionId, setQueueActionId] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
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
    queryFn: async () => (await loadHistory({ data: { runId } })).data,
    staleTime: 0,
    retry: 1,
  });

  const eligible = useMemo(() => preparationQuery.data?.candidates ?? [], [preparationQuery.data]);
  const history = historyQuery.data;
  const queueRows = (history?.rows ?? []) as QueueRow[];
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
          setManualBatches(fallbackBatches(eligible));
          toast.error(error instanceof Error ? error.message : "A busca automática falhou. As opções elegíveis podem ser cotadas manualmente.");
        }
      } finally {
        if (!cancelled) setAutoLoading(false);
      }
    }

    void collect();
    return () => {
      cancelled = true;
    };
  }, [collectAutoOdds, eligible, queueExists, runId]);

  const visibleManualIds = useMemo(
    () => new Set(manualBatches.slice(0, visibleBatchCount).flat()),
    [manualBatches, visibleBatchCount],
  );
  const manualCandidates = useMemo(
    () => eligible.filter((candidate) => visibleManualIds.has(candidate.predictionId)),
    [eligible, visibleManualIds],
  );
  const automaticCandidates = useMemo(
    () => eligible.filter((candidate) => autoQuotes[candidate.predictionId]?.status === "MATCHED"),
    [autoQuotes, eligible],
  );
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
      toast.error("Nenhuma odd válida está disponível para avaliar.");
      return;
    }

    setBuilding(true);
    try {
      const result = await buildQueue({ data: { runId, entries } });
      setEmptyQueueMessage(result.data.totalQualified === 0 ? result.data.message : null);
      await historyQuery.refetch();
      toast.success(result.data.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar a fila de decisão.");
    } finally {
      setBuilding(false);
    }
  }

  async function nextBatch() {
    try {
      await loadNextBatch({ data: { runId } });
      await historyQuery.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível carregar o próximo lote.");
    }
  }

  async function acceptRow(queueId: string) {
    setQueueActionId(queueId);
    try {
      await accept({ data: { queueId } });
      await historyQuery.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível escolher esta opção.");
    } finally {
      setQueueActionId(null);
    }
  }

  async function declineRow(queueId: string) {
    setQueueActionId(queueId);
    try {
      await decline({ data: { queueId } });
      const refreshed = await historyQuery.refetch();
      const fresh = refreshed.data;
      const stillShown = ((fresh?.rows ?? []) as QueueRow[]).some((row) => row.queue_state === "SHOWN");
      if (!stillShown && !fresh?.exhausted && (fresh?.acceptedCount ?? 0) < (fresh?.dailySelectionLimit ?? 3)) {
        await loadNextBatch({ data: { runId } });
        await historyQuery.refetch();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível recusar esta opção.");
    } finally {
      setQueueActionId(null);
    }
  }

  async function finalizeChoices() {
    setFinalizing(true);
    try {
      await finalize({ data: { runId } });
      await historyQuery.refetch();
      navigate({ to: "/run/$runId/resultado", params: { runId }, search: { mode: "experimental" } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível confirmar as escolhas.");
      setFinalizing(false);
    }
  }

  if (preparationQuery.isError || historyQuery.isError) {
    return (
      <section className="panel mt-4 border-destructive/30 p-5">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Não foi possível carregar as opções</h2>
            <p className="mt-1 text-sm text-muted-foreground">O resultado da análise continua preservado no servidor. Atualize esta etapa para retomar.</p>
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
            <p className="mt-1 text-sm text-muted-foreground">Esta rodada já foi finalizada no servidor. Você pode revisar as sugestões e seguir para a confirmação de stake.</p>
            <Button className="mt-4" onClick={() => navigate({ to: "/run/$runId/resultado", params: { runId }, search: { mode: "experimental" } })}>Ver sugestões</Button>
          </div>
        </div>
      </section>
    );
  }

  if (emptyQueueMessage && !queueExists) {
    return (
      <section className="panel mt-4 border-warning/25 p-5">
        <h2 className="font-semibold">Nenhuma opção passou por todos os critérios</h2>
        <p className="mt-1 text-sm text-muted-foreground">{emptyQueueMessage}</p>
        <p className="mt-2 text-xs text-muted-foreground">O sistema não cria sugestões artificiais para preencher um lote.</p>
        <Button className="mt-4" variant="outline" onClick={() => setEmptyQueueMessage(null)}>Rever as odds informadas</Button>
      </section>
    );
  }

  if (queueExists) {
    return (
      <section className="panel mt-4 overflow-hidden border-primary/20">
        <div className="border-b border-border p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="label-eyebrow">Fila de decisão</p>
              <h2 className="mt-1 text-lg font-semibold">Escolha até {dailyLimit} opções hoje</h2>
              <p className="mt-1 text-xs text-muted-foreground">O servidor mantém a ordem por valor esperado e evita duas escolhas do mesmo jogo. Cada lote mostra no máximo 10 opções reais.</p>
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">{acceptedCount}/{dailyLimit} escolhidas</span>
          </div>
        </div>

        {acceptedRows.length > 0 && (
          <CollapsiblePanel className="m-4 mb-0 bg-transparent shadow-none sm:m-5 sm:mb-0" title="Já escolhidas" description="Essas opções ocupam o limite diário" meta={acceptedRows.length} defaultOpen>
            <ul className="divide-y divide-border">
              {acceptedRows.map((row) => (
                <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium">{row.match_label}</p>
                  <p className="text-xs text-muted-foreground">{row.market_label} · odd {dec(row.entry_odd)} · EV {pct(row.expected_value, 1)}</p>
                </li>
              ))}
            </ul>
          </CollapsiblePanel>
        )}

        {shown.length > 0 && acceptedCount < dailyLimit && (
          <div className="divide-y divide-border/70">
            {shown.map((row) => (
              <article key={row.id} className="p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">#{row.rank_global} · {row.competition ?? "Competição"} · {FAMILY_LABELS[row.market_family] ?? row.market_family}</p>
                    <h3 className="mt-1 text-base font-semibold">{row.match_label}</h3>
                    <p className="text-sm text-muted-foreground">{row.market_label}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Odd {dec(row.entry_odd)}</span>
                      <span>Chance {pct(row.model_probability)}</span>
                      <span>EV {pct(row.expected_value)}</span>
                      <span>Vantagem {pct(row.edge)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" className="min-h-11" disabled={queueActionId === row.id} onClick={() => void declineRow(row.id)}>
                      <X className="mr-1 size-4" /> Recusar
                    </Button>
                    <Button className="min-h-11" disabled={queueActionId === row.id || acceptedCount >= dailyLimit} onClick={() => void acceptRow(row.id)}>
                      <Check className="mr-1 size-4" /> Escolher
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {shown.length === 0 && !exhausted && acceptedCount < dailyLimit && (
          <div className="p-5">
            <p className="text-sm text-muted-foreground">Este lote terminou. Há outras opções qualificadas na fila.</p>
            <Button className="mt-3" variant="outline" onClick={() => void nextBatch()}>Mostrar próximo lote</Button>
          </div>
        )}

        {exhausted && acceptedCount === 0 && (
          <div className="p-5">
            <p className="font-medium">Nenhuma opção qualificada restou nesta rodada.</p>
            <p className="mt-1 text-sm text-muted-foreground">O sistema não cria uma recomendação artificial para preencher a tela.</p>
          </div>
        )}

        {canFinalize && (
          <div className="border-t border-border p-4 sm:p-5">
            <Button className="min-h-12 w-full sm:w-auto" disabled={finalizing} onClick={() => void finalizeChoices()}>
              {finalizing ? "Confirmando…" : `CONFIRMAR ${acceptedCount} ESCOLHA${acceptedCount === 1 ? "" : "S"}`}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">A confirmação é registrada no servidor e libera a etapa de stake; nenhuma escolha fica somente no navegador.</p>
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
            <p className="label-eyebrow">Cotação</p>
            <h2 className="mt-1 text-lg font-semibold">Conferir preços reais antes da fila</h2>
            <p className="mt-1 text-xs text-muted-foreground">A Bet365 é consultada primeiro. O frontend não repete chamadas automaticamente; o backend controla cache, limite compartilhado e novas tentativas.</p>
          </div>
          {autoLoading && <span className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Buscando odds</span>}
        </div>
      </div>

      {preparationQuery.isLoading || autoLoading ? (
        <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Organizando as cotações…</div>
      ) : eligible.length === 0 ? (
        <div className="p-5 text-sm text-muted-foreground">Nenhuma linha pôde ser modelada com os dados disponíveis nesta rodada.</div>
      ) : (
        <>
          {automaticCandidates.length > 0 && (
            <CollapsiblePanel className="m-4 mb-0 bg-transparent shadow-none sm:m-5 sm:mb-0" title="Odds encontradas automaticamente" description="Serão avaliadas junto com as odds manuais" meta={automaticCandidates.length} defaultOpen>
              <ul className="divide-y divide-border">
                {automaticCandidates.map((candidate) => {
                  const quote = autoQuotes[candidate.predictionId];
                  return (
                    <li key={candidate.predictionId} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                      <div><p className="text-sm font-medium">{candidate.matchLabel}</p><p className="text-xs text-muted-foreground">{candidate.marketLabel}</p></div>
                      <div className="sm:text-right"><p className="num text-sm font-semibold">odd {dec(quote?.odd)}</p><p className="text-[11px] text-muted-foreground">Bet365 · automática</p></div>
                    </li>
                  );
                })}
              </ul>
            </CollapsiblePanel>
          )}

          {manualCandidates.length > 0 && (
            <div className="mt-4 divide-y divide-border/70 border-t border-border">
              {manualCandidates.map((candidate) => {
                const open = Boolean(details[candidate.predictionId]);
                const quote = autoQuotes[candidate.predictionId];
                return (
                  <div key={candidate.predictionId} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:p-5">
                    <div>
                      <p className="text-sm font-medium">{candidate.matchLabel}</p>
                      <p className="text-xs text-muted-foreground">{candidate.marketLabel} · chance {pct(candidate.probabilityExperimental)}</p>
                      {quote?.status === "LINE_MISMATCH" && <p className="mt-1 text-[11px] text-warning">A linha automática não corresponde ao contrato analisado; informe a odd correta.</p>}
                      {open && <p className="mt-2 text-xs text-muted-foreground">Odd de referência {dec(candidate.fairOddExperimental)} · linha {candidate.lineCanonical ?? "—"}</p>}
                    </div>
                    <label className="text-[11px] text-muted-foreground">Odd Bet365
                      <Input inputMode="decimal" value={odds[candidate.predictionId] ?? ""} onChange={(event) => setOdds((current) => ({ ...current, [candidate.predictionId]: event.target.value }))} className="num mt-1 w-28" />
                    </label>
                    <button type="button" className="inline-flex min-h-10 items-center gap-1 text-xs text-accent" onClick={() => setDetails((current) => ({ ...current, [candidate.predictionId]: !open }))}><Info className="size-3" /> {open ? "Ocultar" : "Detalhes"}</button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="border-t border-border p-4 sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="min-h-12" disabled={building} onClick={() => void createDecisionQueue()}>{building ? "Montando fila…" : "AVALIAR E ABRIR FILA DE DECISÃO"}</Button>
              {remainingManual > 0 && (
                <Button variant="outline" className="min-h-12" onClick={() => setVisibleBatchCount((count) => Math.min(manualBatches.length, count + 1))}>Mostrar mais odds manuais ({remainingManual})</Button>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Somente opções que passam pelos critérios do backend entram na fila. Ela pode conter menos de 10 itens ou nenhum.</p>
          </div>
        </>
      )}
    </section>
  );
}
