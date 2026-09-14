import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Loader2, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { Button } from "@/components/ui/button";
import {
  getOpenExperimentalBets,
  settleOpenExperimentalBet,
} from "@/lib/bankroll.functions";
import { getCanonicalBankrollSnapshot } from "@/lib/canonical-bankroll.browser";
import {
  allowedFinancialSettlementOutcomes,
  type FinancialSettlementOutcome,
} from "@/lib/engine/financial-settlement";
import { repairMojibake } from "@/lib/text";

export const Route = createFileRoute("/open-bets")({
  head: () => ({ meta: [{ title: "Apostas em andamento · Bet Value Engine" }] }),
  component: OpenBetsScreen,
});

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const date = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
};

function openBetCountLabel(count: number) {
  return count === 1 ? "1 aposta em andamento" : `${count} apostas em andamento`;
}

const OUTCOME_COPY: Record<FinancialSettlementOutcome, { button: string; confirmation: string; toast: string }> = {
  WIN: { button: "Ganhou", confirmation: "ganhou", toast: "aposta ganha" },
  HALF_WIN: { button: "Meia vitória", confirmation: "teve meia vitória", toast: "meia vitória registrada" },
  PUSH: { button: "Devolvida", confirmation: "foi devolvida (push)", toast: "push registrado" },
  HALF_LOSS: { button: "Meia derrota", confirmation: "teve meia derrota", toast: "meia derrota registrada" },
  LOSS: { button: "Perdeu", confirmation: "perdeu", toast: "aposta perdida" },
  VOID: { button: "Anulada", confirmation: "foi anulada", toast: "aposta anulada" },
};

type PendingOutcome = { id: string; outcome: FinancialSettlementOutcome } | null;

function OpenBetsScreen() {
  const load = useServerFn(getOpenExperimentalBets);
  const settle = useServerFn(settleOpenExperimentalBet);
  const [pendingOutcome, setPendingOutcome] = useState<PendingOutcome>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["open-experimental-bets"],
    queryFn: () => load(),
  });
  const bankrollQuery = useQuery({
    queryKey: ["canonical-bankroll"],
    queryFn: getCanonicalBankrollSnapshot,
  });
  const bankroll = bankrollQuery.data?.bankroll;
  const loading = isLoading || bankrollQuery.isLoading;
  const loadFailed = isError || bankrollQuery.isError;
  const displayError = error ?? bankrollQuery.error;

  async function refreshAll() {
    await Promise.all([refetch(), bankrollQuery.refetch()]);
  }

  async function finish(id: string, outcome: FinancialSettlementOutcome) {
    if (settlingId !== null) return;
    setSettlingId(id);
    try {
      await settle({ data: { id, outcome } });
      setPendingOutcome(null);
      await refreshAll();
      toast.success(`Resultado salvo: ${OUTCOME_COPY[outcome].toast}. A banca foi atualizada.`);
    } catch {
      toast.error("Não foi possível salvar o resultado. A banca não foi alterada; tente novamente.");
    } finally {
      setSettlingId(null);
    }
  }

  return (
    <AppShell stage="open-bets">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="label-eyebrow">Acompanhamento</p>
            <h1 className="page-heading mt-1.5">Apostas em andamento</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Depois do jogo, informe o resultado aqui. Esta é a única tela que encerra apostas e atualiza a banca.
            </p>
          </div>
          <Button asChild variant="outline" className="min-h-12 w-full shrink-0 sm:min-h-11 sm:w-auto">
            <Link to="/analytics">Ver desempenho</Link>
          </Button>
        </div>

        {data && bankroll && (
          <div className="mt-5">
            <div className="panel flex flex-col gap-3 border-primary/15 bg-primary/[0.035] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div>
                <p className="text-xs text-muted-foreground">Saldo disponível</p>
                <p className="num mt-1 text-3xl font-semibold tracking-tight text-primary sm:text-2xl">{money(bankroll.available)}</p>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/35 px-3 py-2 sm:bg-transparent sm:p-0">
                <span className="text-xs text-muted-foreground sm:hidden">Em aberto</span>
                <p className="text-xs font-medium text-foreground sm:text-muted-foreground">{openBetCountLabel(data.rows.length)}</p>
              </div>
            </div>
            <CollapsiblePanel className="mt-3" title="Ver saldo completo" description="Banca total e valor já comprometido">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div><p className="text-xs text-muted-foreground">Banca total</p><p className="num mt-1 text-lg font-semibold">{money(bankroll.equity)}</p></div>
                <div><p className="text-xs text-muted-foreground">Em apostas</p><p className="num mt-1 text-lg font-semibold">{money(bankroll.locked)}</p></div>
              </div>
            </CollapsiblePanel>
          </div>
        )}

        {loading && (
          <div className="panel mt-5 flex items-center gap-3 p-5 text-sm text-muted-foreground" role="status" aria-live="polite"><Loader2 className="size-4 animate-spin" aria-hidden /> Carregando apostas…</div>
        )}

        {loadFailed && (
          <div className="panel mt-5 border-destructive/30 p-5" role="alert">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Não foi possível carregar as apostas em andamento</p>
                <p className="mt-1 text-sm text-muted-foreground">Tente novamente antes de registrar qualquer resultado.</p>
                {displayError instanceof Error && <p className="mt-2 text-xs text-destructive">{displayError.message}</p>}
                <Button className="mt-4 min-h-12 w-full sm:min-h-11 sm:w-auto" variant="outline" onClick={() => void refreshAll()}>Tentar novamente</Button>
              </div>
            </div>
          </div>
        )}

        {!loading && !loadFailed && data?.rows.length === 0 && (
          <div className="panel mt-5 p-5"><p className="font-medium">Nenhuma aposta em andamento agora.</p><p className="mt-1 text-sm text-muted-foreground">Quando você registrar uma sugestão, ela aparece aqui até o resultado ser informado.</p></div>
        )}

        {!loadFailed && (
          <div className="mt-5 grid gap-3 sm:gap-4">
            {data?.rows.map((row) => {
              const confirming = pendingOutcome?.id === row.id;
              const saving = settlingId === row.id;
              const lineCanonical = row.line_canonical === null ? null : Number(row.line_canonical);
              const outcomes = allowedFinancialSettlementOutcomes({
                market: row.market,
                lineCanonical: Number.isFinite(lineCanonical) ? lineCanonical : null,
                side: row.side,
              });
              return (
                <article key={row.id} className="panel overflow-hidden p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{date(row.target_date)} · {repairMojibake(row.competition)}</p>
                      <h2 className="mt-1 text-lg font-semibold leading-snug">{row.match_label}</h2>
                      <p className="mt-0.5 text-sm text-muted-foreground">{row.market_label}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:block sm:text-right">
                      <div><p className="text-xs text-muted-foreground">Valor apostado</p><p className="num mt-1 text-xl font-semibold">{money(Number(row.stake_brl ?? 0))}</p></div>
                      <div className="sm:mt-2"><p className="text-xs text-muted-foreground">Odd executada</p><p className="num mt-1 text-xl font-semibold sm:text-sm sm:font-medium sm:text-muted-foreground">{Number(row.entry_odd).toFixed(2)}</p></div>
                    </div>
                  </div>

                  {!confirming ? (
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                      {outcomes.map((outcome) => (
                        <Button
                          key={outcome}
                          className="min-h-12 sm:min-h-11 sm:min-w-28"
                          variant={outcome === "LOSS" || outcome === "HALF_LOSS" ? "destructive" : outcome === "WIN" || outcome === "HALF_WIN" ? "default" : "outline"}
                          disabled={settlingId !== null}
                          onClick={() => setPendingOutcome({ id: row.id, outcome })}
                        >
                          {outcome === "WIN" || outcome === "HALF_WIN" ? <Check className="mr-2 size-4" aria-hidden /> : outcome === "LOSS" || outcome === "HALF_LOSS" ? <X className="mr-2 size-4" aria-hidden /> : null}
                          {OUTCOME_COPY[outcome].button}
                        </Button>
                      ))}
                    </div>
                  ) : pendingOutcome ? (
                    <div className="mt-4 rounded-xl bg-warning/8 p-3 ring-1 ring-warning/25" role="alert">
                      <p className="text-sm font-medium">
                        Confirmar que esta aposta {OUTCOME_COPY[pendingOutcome.outcome].confirmation}?
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">Ao confirmar, a aposta será encerrada e a banca será recalculada pela odd realmente executada. Esta ação não deve ser repetida.</p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <Button
                          className="min-h-12 w-full sm:min-h-11 sm:w-auto"
                          variant={pendingOutcome.outcome === "LOSS" || pendingOutcome.outcome === "HALF_LOSS" ? "destructive" : "default"}
                          disabled={settlingId !== null}
                          onClick={() => void finish(row.id, pendingOutcome.outcome)}
                        >
                          {saving && <Loader2 className="mr-2 size-4" aria-hidden />}
                          {saving ? "Salvando…" : "Confirmar resultado"}
                        </Button>
                        <Button className="min-h-12 w-full sm:min-h-11 sm:w-auto" variant="outline" disabled={settlingId !== null} onClick={() => setPendingOutcome(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
