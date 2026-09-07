import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  confirmExperimentalBet,
  getExperimentalBetPlan,
} from "@/lib/bankroll.functions";

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export function BetConfirmationFlow({ runId }: { runId: string }) {
  const loadPlan = useServerFn(getExperimentalBetPlan);
  const confirm = useServerFn(confirmExperimentalBet);
  const [custom, setCustom] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["experimental-bet-plan", runId],
    queryFn: () => loadPlan({ data: { runId } }),
  });

  async function submit(stakeBrl: number) {
    const proposal = data?.nextProposal;
    if (!proposal) return;
    setSaving(true);
    try {
      await confirm({ data: { id: proposal.id, stakeBrl } });
      setCustom("");
      setShowCustom(false);
      await refetch();
      toast.success(stakeBrl > 0 ? "Aposta confirmada. Recalculamos o saldo para a próxima." : "Sugestão recusada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível confirmar.");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <section className="panel mt-8 flex items-center gap-3 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Calculando o valor sugerido…
      </section>
    );
  }

  if (!data || data.all.length === 0) return null;

  const proposal = data.nextProposal;
  if (!proposal) {
    return (
      <section className="panel mt-8 p-6">
        <p className="label-eyebrow">Confirmação das apostas</p>
        <h2 className="mt-1 text-lg font-semibold">Tudo revisado nesta rodada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {data.openCount > 0
            ? `${data.openCount} aposta(s) confirmada(s) estão na tela de Apostas abertas.`
            : "Nenhuma sugestão ficou pendente de confirmação."}
        </p>
      </section>
    );
  }

  const suggested = Number(proposal.suggestedStake);
  const customNumber = Number(custom.replace(",", "."));

  return (
    <section className="panel mt-8 overflow-hidden border-primary/40">
      <div className="border-b border-border bg-primary/5 px-6 py-4">
        <p className="label-eyebrow">Confirmar aposta</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">{proposal.match_label}</h2>
            <p className="text-muted-foreground">{proposal.market_label}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Saldo disponível agora</p>
            <p className="num text-2xl font-semibold">{money(data.bankroll.available)}</p>
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Odd informada</p>
            <p className="num mt-1 text-lg">{Number(proposal.entry_odd).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Retorno esperado</p>
            <p className="num mt-1 text-lg">{(Number(proposal.expected_value ?? 0) * 100).toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Valor sugerido</p>
            <p className="num mt-1 text-lg font-semibold text-primary">{money(suggested)}</p>
          </div>
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          A sugestão usa o saldo que ainda está disponível. Ao confirmar, esse valor fica reservado e a próxima sugestão é recalculada com o novo saldo.
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          {suggested > 0 && (
            <Button disabled={saving} onClick={() => void submit(suggested)}>
              <Check className="mr-2 size-4" /> Aceitar {money(suggested)}
            </Button>
          )}
          <Button variant="outline" disabled={saving} onClick={() => setShowCustom((value) => !value)}>
            Informar outro valor
          </Button>
          <Button variant="ghost" disabled={saving} onClick={() => void submit(0)}>
            <X className="mr-2 size-4" /> Não apostar
          </Button>
        </div>

        {showCustom && (
          <div className="mt-4 flex max-w-sm items-end gap-3 rounded-lg border border-border p-4">
            <label className="flex-1 text-sm">
              <span className="text-muted-foreground">Valor que você quer usar</span>
              <Input
                className="num mt-2"
                inputMode="decimal"
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                placeholder="0,00"
              />
            </label>
            <Button
              disabled={saving || !Number.isFinite(customNumber) || customNumber < 0}
              onClick={() => void submit(Number.isFinite(customNumber) ? customNumber : 0)}
            >
              Confirmar
            </Button>
          </div>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          Digitar 0 equivale a recusar a sugestão. Você também pode usar um valor diferente do sugerido, desde que não ultrapasse o saldo disponível.
        </p>
      </div>
    </section>
  );
}
