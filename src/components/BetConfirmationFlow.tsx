import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Check, Loader2, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { MetricHelp } from "@/components/MetricHelp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  confirmExperimentalBet,
  getExperimentalBetPlan,
} from "@/lib/bankroll.functions";

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const EXECUTION_QUOTE_MAX_AGE_MS = 10 * 60 * 1000;

function decimalInput(value: string) {
  return Number(value.replace(",", "."));
}

export function BetConfirmationFlow({ runId }: { runId: string }) {
  const loadPlan = useServerFn(getExperimentalBetPlan);
  const confirm = useServerFn(confirmExperimentalBet);
  const [custom, setCustom] = useState("");
  const [currentOdd, setCurrentOdd] = useState("");
  const [currentLine, setCurrentLine] = useState("");
  const [quoteCapturedAt, setQuoteCapturedAt] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [showDeclineConfirm, setShowDeclineConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["experimental-bet-plan", runId],
    queryFn: () => loadPlan({ data: { runId } }),
  });

  const proposalId = data?.nextProposal?.id ?? null;
  useEffect(() => {
    setCurrentOdd("");
    setCurrentLine("");
    setQuoteCapturedAt(null);
    setCustom("");
    setShowCustom(false);
    setShowDeclineConfirm(false);
  }, [proposalId]);

  function markQuoteObserved() {
    setQuoteCapturedAt(new Date().toISOString());
  }

  async function submit(stakeBrl: number) {
    const proposal = data?.nextProposal;
    if (!proposal || saving) return;

    let confirmedOdd: number | null = null;
    let confirmedLine: number | null = null;
    if (stakeBrl > 0) {
      confirmedOdd = decimalInput(currentOdd);
      if (!Number.isFinite(confirmedOdd) || confirmedOdd <= 1) {
        toast.error("Confira e informe a odd atual da Bet365 antes de registrar.");
        return;
      }
      if (
        !quoteCapturedAt ||
        !Number.isFinite(Date.parse(quoteCapturedAt)) ||
        Date.now() - Date.parse(quoteCapturedAt) > EXECUTION_QUOTE_MAX_AGE_MS
      ) {
        toast.error("A cotação ficou desatualizada. Confira novamente a odd e a linha atuais da Bet365.");
        return;
      }

      const canonicalLine = proposal.line_canonical === null ? null : Number(proposal.line_canonical);
      if (canonicalLine !== null) {
        confirmedLine = decimalInput(currentLine);
        if (!Number.isFinite(confirmedLine)) {
          toast.error("Confira e informe também a linha atual da Bet365.");
          return;
        }
      }
    }

    setSaving(true);
    try {
      await confirm({
        data: {
          id: proposal.id,
          stakeBrl,
          currentOdd: confirmedOdd,
          currentLine: confirmedLine,
          currentQuoteCapturedAt: stakeBrl > 0 ? quoteCapturedAt : null,
        },
      });
      setCustom("");
      setCurrentOdd("");
      setCurrentLine("");
      setQuoteCapturedAt(null);
      setShowCustom(false);
      setShowDeclineConfirm(false);
      await refetch();
      toast.success(
        stakeBrl > 0
          ? `Aposta registrada. ${money(stakeBrl)} foi separado da banca disponível.`
          : "Sugestão descartada. Ela não será registrada como aposta.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível confirmar o registro. Nada foi alterado.");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <section className="panel mt-4 flex items-center gap-3 p-5 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" /> Preparando o registro das apostas…
      </section>
    );
  }

  if (isError) {
    return (
      <section className="panel mt-4 border-destructive/30 p-5" role="alert">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Não foi possível carregar o registro das apostas</p>
            <p className="mt-1 text-sm text-muted-foreground">As escolhas continuam salvas. Tente novamente antes de sair desta etapa.</p>
            {error instanceof Error && <p className="mt-2 text-xs text-destructive">{error.message}</p>}
            <Button className="mt-4 min-h-11" variant="outline" onClick={() => void refetch()}>Tentar novamente</Button>
          </div>
        </div>
      </section>
    );
  }

  if (!data || data.all.length === 0) {
    return (
      <section className="panel mt-4 p-5">
        <p className="font-medium">Nenhuma aposta precisa ser registrada nesta rodada.</p>
        <p className="mt-1 text-sm text-muted-foreground">Você pode iniciar uma nova análise ou acompanhar o desempenho.</p>
      </section>
    );
  }

  const proposal = data.nextProposal;
  if (!proposal) {
    return (
      <section className="panel mt-4 max-w-5xl p-5">
        <p className="label-eyebrow">Registro concluído</p>
        <h2 className="mt-1 text-lg font-semibold">Tudo revisado nesta rodada</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.openCount > 0
            ? `${data.openCount} aposta${data.openCount === 1 ? "" : "s"} registrada${data.openCount === 1 ? "" : "s"} aparece${data.openCount === 1 ? "" : "m"} em “Em andamento”.`
            : "Nenhuma sugestão ficou pendente de registro."}
        </p>
      </section>
    );
  }

  const suggested = Number(proposal.suggestedStake);
  const maxAllowed = Number(proposal.maxAllowedStake);
  const minimumStake = Number(proposal.minimumStake ?? data.bankroll.minStakeBrl ?? 0.5);
  const customNumber = decimalInput(custom);
  const currentOddNumber = decimalInput(currentOdd);
  const canonicalLine = proposal.line_canonical === null ? null : Number(proposal.line_canonical);
  const currentLineNumber = decimalInput(currentLine);
  const quoteConfirmed = Boolean(quoteCapturedAt) && Number.isFinite(currentOddNumber) && currentOddNumber > 1 &&
    (canonicalLine === null || Number.isFinite(currentLineNumber));
  const total = Math.max(1, data.all.length);
  const reviewed = Math.max(0, total - data.proposedCount);
  const currentNumber = Math.min(total, reviewed + 1);
  const suggestedBalanceAfter = Math.max(0, Number(data.bankroll.available) - suggested);
  const customBalanceAfter = Number.isFinite(customNumber)
    ? Math.max(0, Number(data.bankroll.available) - Math.max(0, customNumber))
    : Number(data.bankroll.available);

  return (
    <section className="panel mt-4 overflow-hidden border-primary/30" aria-label="Registrar aposta">
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="label-eyebrow">Aposta {currentNumber} de {total}</p>
            <h2 className="mt-1 text-lg font-semibold sm:text-xl">{proposal.match_label}</h2>
            <p className="text-sm text-muted-foreground">{proposal.market_label}</p>
          </div>
          <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">Revisar e registrar</span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border/60 py-4 sm:grid-cols-4">
          <div><dt className="text-[11px] text-muted-foreground">Odd da decisão</dt><dd className="num mt-1 text-lg font-semibold">{Number(proposal.entry_odd).toFixed(2)}</dd></div>
          <div><dt className="flex items-center text-[11px] text-muted-foreground">EV da decisão <MetricHelp term="EV" /></dt><dd className="num mt-1 text-lg font-semibold">{(Number(proposal.expected_value ?? 0) * 100).toFixed(1)}%</dd></div>
          <div><dt className="text-[11px] text-muted-foreground">Valor sugerido</dt><dd className="num mt-1 text-lg font-semibold text-primary">{money(suggested)}</dd></div>
          <div><dt className="text-[11px] text-muted-foreground">Saldo depois</dt><dd className="num mt-1 text-lg font-semibold">{money(suggestedBalanceAfter)}</dd></div>
        </dl>

        <p className="mt-4 text-sm text-muted-foreground">Registre aqui somente se você realmente fizer esta aposta na Bet365. O aplicativo não envia a aposta para a casa.</p>

        <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <p className="text-sm font-medium">Confira a cotação na Bet365 agora</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">A odd da decisão não é reutilizada automaticamente. Antes de liberar uma stake positiva, o servidor recalcula odd mínima, EV e vantagem com a cotação que você confirmar aqui. A confirmação expira em 10 minutos.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-xs text-muted-foreground">Odd atual</span>
              <Input
                className="num mt-2"
                inputMode="decimal"
                value={currentOdd}
                onChange={(event) => {
                  setCurrentOdd(event.target.value);
                  markQuoteObserved();
                }}
                placeholder="Ex.: 1,85"
              />
            </label>
            {canonicalLine !== null && (
              <label className="text-sm">
                <span className="text-xs text-muted-foreground">Linha atual</span>
                <Input
                  className="num mt-2"
                  inputMode="decimal"
                  value={currentLine}
                  onChange={(event) => {
                    setCurrentLine(event.target.value);
                    markQuoteObserved();
                  }}
                  placeholder={`Linha modelada: ${canonicalLine.toFixed(1).replace(".", ",")}`}
                />
              </label>
            )}
          </div>
          {canonicalLine !== null && (
            <p className="mt-2 text-xs text-muted-foreground">Se a linha atual for diferente de {canonicalLine.toFixed(1).replace(".", ",")}, a aposta será bloqueada e a partida precisará ser recalculada.</p>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {suggested > 0 && (
            <Button className="min-h-12" disabled={saving || !quoteConfirmed} onClick={() => void submit(suggested)}>
              <Check className="mr-2 size-4" /> Registrar {money(suggested)}
            </Button>
          )}
          <Button className="min-h-12" variant="outline" disabled={saving} onClick={() => { setShowCustom((value) => !value); setShowDeclineConfirm(false); }}>
            Usar outro valor
          </Button>
          <Button className="min-h-12" variant="ghost" disabled={saving} onClick={() => { setShowDeclineConfirm(true); setShowCustom(false); }}>
            <X className="mr-2 size-4" /> Descartar esta sugestão
          </Button>
        </div>

        {showCustom && (
          <div className="mt-4 border-t border-border pt-4 sm:max-w-lg">
            <label className="text-sm">
              <span className="text-xs text-muted-foreground">Digite um valor entre {money(minimumStake)} e {money(maxAllowed)}</span>
              <Input className="num mt-2" inputMode="decimal" value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="0,00" />
            </label>
            {Number.isFinite(customNumber) && customNumber > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Saldo estimado após o registro: <span className="num font-medium text-foreground">{money(customBalanceAfter)}</span></p>
            )}
            <Button
              className="mt-3 min-h-11"
              disabled={saving || !quoteConfirmed || !Number.isFinite(customNumber) || customNumber < minimumStake || customNumber > maxAllowed}
              onClick={() => void submit(customNumber)}
            >
              Confirmar {Number.isFinite(customNumber) && customNumber > 0 ? money(customNumber) : "valor"}
            </Button>
          </div>
        )}

        {showDeclineConfirm && (
          <div className="mt-4 rounded-xl border border-warning/30 bg-warning/8 p-3" role="alert">
            <p className="text-sm font-medium">Descartar esta sugestão?</p>
            <p className="mt-1 text-xs text-muted-foreground">Ela ficará registrada como recusada e não reduzirá sua banca disponível.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button className="min-h-11" variant="outline" disabled={saving} onClick={() => setShowDeclineConfirm(false)}>Voltar</Button>
              <Button className="min-h-11" variant="destructive" disabled={saving} onClick={() => void submit(0)}>{saving ? "Descartando…" : "Confirmar descarte"}</Button>
            </div>
          </div>
        )}

        <CollapsiblePanel className="mt-4 bg-transparent shadow-none" title="Como chegamos neste valor?" description="Odd, EV esperado e limites da banca">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <p><span className="text-muted-foreground">Mínimo operacional:</span> <span className="num">{money(minimumStake)}</span></p>
            <p><span className="text-muted-foreground">Máximo permitido:</span> <span className="num">{money(maxAllowed)}</span></p>
            <p><span className="text-muted-foreground">Saldo disponível agora:</span> <span className="num">{money(Number(data.bankroll.available))}</span></p>
            <p><span className="text-muted-foreground">Valor sugerido:</span> <span className="num">{money(suggested)}</span></p>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">O valor sugerido considera o saldo disponível e os limites definidos para a banca. A odd e a linha são revalidadas novamente no servidor no momento do registro; se deixarem de atender à régua, a aposta não é aberta.</p>
        </CollapsiblePanel>
      </div>
    </section>
  );
}