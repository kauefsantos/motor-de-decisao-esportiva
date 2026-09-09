import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { CollapsiblePanel } from "@/components/CollapsiblePanel";
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
      toast.success(stakeBrl > 0 ? "Aposta confirmada. O saldo foi atualizado." : "Sugestão recusada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível confirmar.");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <section className="panel mx-auto mt-4 flex max-w-5xl items-center gap-3 p-5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Calculando quanto apostar…
      </section>
    );
  }

  if (!data || data.all.length === 0) return null;

  const proposal = data.nextProposal;
  if (!proposal) {
    return (
      <section className="panel mx-auto mt-4 max-w-5xl p-5">
        <p className="label-eyebrow">Confirmação</p>
        <h2 className="mt-1 text-lg font-semibold">Tudo revisado nesta rodada</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.openCount > 0
            ? `${data.openCount} aposta(s) confirmada(s) estão em “Em andamento”.`
            : "Nenhuma sugestão ficou pendente de confirmação."}
        </p>
      </section>
    );
  }

  const suggested = Number(proposal.suggestedStake);
  const maxAllowed = Number(proposal.maxAllowedStake);
  const minimumStake = Number(proposal.minimumStake ?? data.bankroll.minStakeBrl ?? 0.5);
  const customNumber = Number(custom.replace(",", "."));

  return (
    <section className="panel mx-auto mt-4 max-w-5xl overflow-hidden border-primary/30">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
        <div>
          <p className="label-eyebrow">Confirmar aposta</p>
          <h2 className="mt-1 text-lg font-semibold sm:text-xl">{proposal.match_label}</h2>
          <p className="text-sm text-muted-foreground">{proposal.market_label}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:min-w-72">
          <div className="metric-tile p-3">
            <p className="text-[11px] text-muted-foreground">Saldo disponível</p>
            <p className="num mt-1 text-lg font-semibold">{money(data.bankroll.available)}</p>
          </div>
          <div className="rounded-lg border border-primary/25 bg-primary/10 p-3">
            <p className="text-[11px] text-primary">Valor sugerido</p>
            <p className="num mt-1 text-lg font-semibold text-primary">{money(suggested)}</p>
          </div>
        </div>
      </div>

      <div className="border-t border-border p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {suggested > 0 && (
            <Button className="min-h-11" disabled={saving} onClick={() => void submit(suggested)}>
              <Check className="mr-2 size-4" /> Apostar {money(suggested)}
            </Button>
          )}
          <Button className="min-h-11" variant="outline" disabled={saving} onClick={() => setShowCustom((value) => !value)}>
            Escolher outro valor
          </Button>
          <Button className="min-h-11" variant="ghost" disabled={saving} onClick={() => void submit(0)}>
            <X className="mr-2 size-4" /> Não apostar
          </Button>
        </div>

        {showCustom && (
          <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border p-3 sm:max-w-md sm:flex-row sm:items-end">
            <label className="flex-1 text-sm">
              <span className="text-xs text-muted-foreground">0 para recusar ou entre {money(minimumStake)} e {money(maxAllowed)}</span>
              <Input className="num mt-2" inputMode="decimal" value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="0,00" />
            </label>
            <Button
              className="min-h-11"
              disabled={saving || !Number.isFinite(customNumber) || customNumber < 0 || (customNumber > 0 && customNumber < minimumStake) || customNumber > maxAllowed}
              onClick={() => void submit(Number.isFinite(customNumber) ? customNumber : 0)}
            >
              Confirmar
            </Button>
          </div>
        )}

        <CollapsiblePanel className="mt-3 bg-transparent shadow-none" title="Como chegamos neste valor?" description="Odd, retorno estimado e limites usados no cálculo">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="metric-tile p-3"><p className="text-[11px] text-muted-foreground">Odd</p><p className="num mt-1">{Number(proposal.entry_odd).toFixed(2)}</p></div>
            <div className="metric-tile p-3"><p className="text-[11px] text-muted-foreground">Retorno estimado</p><p className="num mt-1">{(Number(proposal.expected_value ?? 0) * 100).toFixed(1)}%</p></div>
            <div className="metric-tile p-3"><p className="text-[11px] text-muted-foreground">Mínimo bet365</p><p className="num mt-1">{money(minimumStake)}</p></div>
            <div className="metric-tile p-3"><p className="text-[11px] text-muted-foreground">Máximo permitido</p><p className="num mt-1">{money(maxAllowed)}</p></div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            O valor sugerido considera o saldo disponível e os limites definidos para a banca. Ao confirmar, esse valor fica separado e a próxima sugestão usa o saldo restante.
          </p>
        </CollapsiblePanel>
      </div>
    </section>
  );
}
