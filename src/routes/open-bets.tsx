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

type PendingOutcome = { id: string; outcome: "WIN" | "LOSS" } | null;

function OpenBetsScreen() {
  const load = useServerFn(getOpenExperimentalBets);
  const settle = useServerFn(settleOpenExperimentalBet);
  const [pendingOutcome, setPendingOutcome] = useState<PendingOutcome>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["open-experimental-bets"],
    queryFn: () => load(),
  });

  async function finish(id: string, outcome: "WIN" | "LOSS") {
    if (settlingId !== null) return;
    setSettlingId(id);
    try {
      await settle({ data: { id, outcome } });
      setPendingOutcome(null);
      await refetch();
      toast.success(outcome === "WIN" ? "Acerto registrado." : "Erro registrado.");
    } catch {
      toast.error("Não foi possível atualizar esta aposta. Tente novamente.");
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
            <h1 className="page-heading mt-2">Apostas em andamento</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Depois do jogo, registre o resultado aqui. Esta é a única tela que encerra apostas e atualiza a banca.
            </p>
          </div>
          <Button asChild variant="outline" className="min-h-11 shrink-0">
            <Link to="/analytics">Ver desempenho</Link>
          </Button>
        </div>

        {data && (
          <div className="mt-5">
            <div className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div>
                <p className="text-xs text-muted-foreground">Saldo disponível</p>
                <p className="num mt-1 text-2xl font-semibold text-primary">{money(data.bankroll.available)}</p>
              </div>
              <p className="text-xs text-muted-foreground">{openBetCountLabel(data.rows.length)}</p>
            </div>
            <CollapsiblePanel className="mt-3" title="Ver saldo completo" description="Banca total e valor já comprometido">
              <div className="grid grid-cols-2 gap-2">
                <div className="metric-tile p-3"><p className="text-xs text-muted-foreground">Banca total</p><p className="num mt-1 text-lg">{money(data.bankroll.equity)}</p></div>
                <div className="metric-tile p-3"><p className="text-xs text-muted-foreground">Em apostas</p><p className="num mt-1 text-lg">{money(data.bankroll.locked)}</p></div>
              </div>
            </CollapsiblePanel>
          </div>
        )}

        {isLoading && (
          <div className="panel mt-5 flex items-center gap-3 p-5 text-sm text-muted-foreground" role="status" aria-live="polite"><Loader2 className="size-4 animate-spin" aria-hidden /> Carregando apostas…</div>
        )}

        {isError && (
          <div className="panel mt-5 border-destructive/30 p-5" role="alert">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Não foi possível carregar as apostas em andamento</p>
                <p className="mt-1 text-sm text-muted-foreground">Tente novamente antes de registrar qualquer resultado.</p>
                {error instanceof Error && <p className="mt-2 text-xs text-destructive">{error.message}</p>}
                <Button className="mt-4 min-h-11" variant="outline" onClick={() => void refetch()}>Tentar novamente</Button>
              </div>
            </div>
          </div>
        )}

        {!isLoading && !isError && data?.rows.length === 0 && (
          <div className="panel mt-5 p-5"><p className="font-medium">Nenhuma aposta em andamento agora.</p><p className="mt-1 text-sm text-muted-foreground">Quando você registrar uma sugestão, ela aparece aqui até o resultado ser informado.</p></div>
        )}

        {!isError && (
          <div className="mt-5 grid gap-3">
            {data?.rows.map((row) => {
              const confirming = pendingOutcome?.id === row.id;
              const saving = settlingId === row.id;
              return (
                <article key={row.id} className="panel p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{date(row.target_date)} · {row.competition ?? ""}</p>
                      <h2 className="mt-1 text-lg font-semibold">{row.match_label}</h2>
                      <p className="text-sm text-muted-foreground">{row.market_label}</p>
                    </div>
                    <div className="flex items-end justify-between gap-5 sm:block sm:text-right">
                      <div><p className="text-xs text-muted-foreground">Valor apostado</p><p className="num mt-1 text-xl font-semibold">{money(Number(row.stake_brl ?? 0))}</p></div>
                      <p className="num text-sm text-muted-foreground">odd {Number(row.entry_odd).toFixed(2)}</p>
                    </div>
                  </div>

                  {!confirming ? (
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                      <Button
                        className="min-h-11 sm:min-w-32"
                        disabled={settlingId !== null}
                        onClick={() => setPendingOutcome({ id: row.id, outcome: "WIN" })}
                      >
                        <Check className="mr-2 size-4" aria-hidden /> Acertou
                      </Button>
                      <Button
                        className="min-h-11 sm:min-w-32"
                        variant="destructive"
                        disabled={settlingId !== null}
                        onClick={() => setPendingOutcome({ id: row.id, outcome: "LOSS" })}
                      >
                        <X className="mr-2 size-4" aria-hidden /> Errou
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-lg border border-warning/30 bg-warning/8 p-3" role="alert">
                      <p className="text-sm font-medium">
                        Confirmar resultado: {pendingOutcome.outcome === "WIN" ? "acertou" : "errou"}?
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">Essa ação atualiza a banca e encerra esta aposta.</p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <Button
                          className="min-h-11"
                          variant={pendingOutcome.outcome === "WIN" ? "default" : "destructive"}
                          disabled={settlingId !== null}
                          onClick={() => void finish(row.id, pendingOutcome.outcome)}
                        >
                          {saving && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
                          Confirmar resultado
                        </Button>
                        <Button className="min-h-11" variant="outline" disabled={settlingId !== null} onClick={() => setPendingOutcome(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
