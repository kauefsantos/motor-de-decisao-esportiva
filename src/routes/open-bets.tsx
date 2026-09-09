import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  getOpenExperimentalBets,
  settleOpenExperimentalBet,
} from "@/lib/bankroll.functions";

export const Route = createFileRoute("/open-bets")({
  head: () => ({
    meta: [
      { title: "Apostas em andamento · Bet Value Engine" },
      { name: "description", content: "Veja as apostas confirmadas e marque o resultado depois do jogo." },
    ],
  }),
  component: OpenBetsScreen,
});

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

function OpenBetsScreen() {
  const load = useServerFn(getOpenExperimentalBets);
  const settle = useServerFn(settleOpenExperimentalBet);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["open-experimental-bets"],
    queryFn: () => load(),
  });

  async function finish(id: string, outcome: "WIN" | "LOSS") {
    try {
      await settle({ data: { id, outcome } });
      await refetch();
      toast.success(outcome === "WIN" ? "Acerto registrado." : "Erro registrado.");
    } catch {
      toast.error("Não foi possível atualizar esta aposta. Tente novamente.");
    }
  }

  return (
    <AppShell stage="open-bets">
      <p className="label-eyebrow">Acompanhamento</p>
      <h1 className="mt-2 text-3xl font-bold">Apostas em andamento</h1>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        Aqui ficam as sugestões que você decidiu apostar. Depois do jogo, marque se a aposta acertou ou errou.
      </p>

      {data && (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="panel p-5">
            <p className="text-xs text-muted-foreground">Banca total</p>
            <p className="num mt-1 text-2xl">{money(data.bankroll.equity)}</p>
          </div>
          <div className="panel p-5">
            <p className="text-xs text-muted-foreground">Valor em apostas em andamento</p>
            <p className="num mt-1 text-2xl">{money(data.bankroll.locked)}</p>
          </div>
          <div className="panel p-5">
            <p className="text-xs text-muted-foreground">Saldo disponível</p>
            <p className="num mt-1 text-2xl">{money(data.bankroll.available)}</p>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="panel mt-8 flex items-center gap-3 p-8 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando apostas…
        </div>
      )}

      {!isLoading && data?.rows.length === 0 && (
        <div className="panel mt-8 p-8">
          <p className="text-lg font-medium">Nenhuma aposta em andamento agora.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Quando você confirmar uma sugestão, ela aparecerá aqui até o resultado ser informado.
          </p>
        </div>
      )}

      <div className="mt-8 grid gap-4">
        {data?.rows.map((row) => (
          <article key={row.id} className="panel p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs text-muted-foreground">{row.target_date ?? ""} · {row.competition ?? ""}</p>
                <h2 className="mt-1 text-xl font-semibold">{row.match_label}</h2>
                <p className="text-muted-foreground">{row.market_label}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Valor apostado</p>
                <p className="num mt-1 text-xl font-semibold">{money(Number(row.stake_brl ?? 0))}</p>
                <p className="num mt-1 text-sm text-muted-foreground">odd {Number(row.entry_odd).toFixed(2)}</p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <Button className="min-w-32" onClick={() => void finish(row.id, "WIN")}>
                <Check className="mr-2 size-4" /> Acertou
              </Button>
              <Button className="min-w-32" variant="destructive" onClick={() => void finish(row.id, "LOSS")}>
                <X className="mr-2 size-4" /> Errou
              </Button>
            </div>
          </article>
        ))}
      </div>
    </AppShell>
  );
}