import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getExperimentalAnalytics,
  updateExperimentalTracking,
} from "@/lib/analytics.functions";

export const Route = createFileRoute("/analytics")({
  head: () => ({ meta: [{ title: "Desempenho · Bet Value Engine" }] }),
  component: AnalyticsScreen,
});

type AnalyticsData = Awaited<ReturnType<typeof getExperimentalAnalytics>>;
type TrackingRow = AnalyticsData["rows"][number];

type Draft = {
  stake: string;
  closingOdd: string;
  result: "PENDING" | "WIN" | "LOSS" | "PUSH" | "VOID";
};

const money = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const pct = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined ? "—" : `${(value * 100).toFixed(digits)}%`;
const odd = (value: number | string | null | undefined) =>
  value === null || value === undefined ? "—" : Number(value).toFixed(2);
const date = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
};

const FAMILY_LABELS: Record<string, string> = {
  CORNERS: "Escanteios",
  GOALS: "Gols da partida",
  TEAM_GOALS: "Gols por time",
  "1X2": "Resultado",
  DOUBLE_CHANCE: "Dupla chance",
  BTTS: "Ambas marcam",
};

function friendlyResult(result: string) {
  if (result === "WIN") return "Ganhou";
  if (result === "LOSS") return "Perdeu";
  if (result === "PUSH") return "Valor devolvido";
  if (result === "VOID") return "Anulada";
  return "Aguardando";
}

function AnalyticsScreen() {
  const fetchAnalytics = useServerFn(getExperimentalAnalytics);
  const updateTracking = useServerFn(updateExperimentalTracking);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["experimental-analytics"],
    queryFn: () => fetchAnalytics(),
  });

  const recent = useMemo(() => (data?.rows ?? []).slice(0, 80), [data]);

  function draftFor(row: TrackingRow): Draft {
    return (
      drafts[row.id] ?? {
        stake: row.stake_brl === null ? "" : String(row.stake_brl),
        closingOdd: row.closing_odd === null ? "" : String(row.closing_odd),
        result: row.result,
      }
    );
  }

  async function save(row: TrackingRow) {
    const draft = draftFor(row);
    const stake = draft.stake.trim() === "" ? null : Number(draft.stake.replace(",", "."));
    const closingOdd = draft.closingOdd.trim() === "" ? null : Number(draft.closingOdd.replace(",", "."));
    if (stake !== null && (!Number.isFinite(stake) || stake < 0)) {
      toast.error("Confira o valor usado.");
      return;
    }
    if (closingOdd !== null && (!Number.isFinite(closingOdd) || closingOdd <= 1)) {
      toast.error("Confira a odd perto do início do jogo.");
      return;
    }

    setSavingId(row.id);
    try {
      await updateTracking({
        data: {
          id: row.id,
          result: draft.result,
          stakeBrl: stake,
          closingOdd,
          notes: null,
        },
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      await refetch();
      toast.success("Histórico atualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AppShell stage="analytics">
      <div className="mx-auto max-w-6xl">
        <p className="label-eyebrow">Acompanhamento</p>
        <h1 className="page-heading mt-2">Como as sugestões estão se saindo?</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Acompanhe resultado, banca e qualidade das estimativas ao longo do tempo.
        </p>

        {isLoading && (
          <div className="panel mt-6 flex items-center gap-3 p-5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando o desempenho…
          </div>
        )}

        {data && (
          <>
            <div className="mt-6 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <MetricCard label="Banca atual" value={money(data.summary.currentBankroll)} hint={`Resultado: ${money(data.summary.totalProfit)}`} highlight />
              <MetricCard label="Resultado acumulado" value={money(data.summary.totalProfit)} hint={`Desde ${date(data.config.startDate)}`} />
              <MetricCard label="Retorno sobre o valor apostado" value={pct(data.summary.roi)} hint={`${data.summary.settled} encerrada(s)`} />
              <MetricCard label="Taxa de acerto" value={pct(data.summary.hitRate)} hint={`${data.summary.wins} ganhos · ${data.summary.losses} perdas`} />
            </div>

            <p className="mt-3 rounded-lg border border-border bg-secondary/20 px-4 py-3 text-sm text-muted-foreground">
              {data.summary.sampleMessage}
            </p>

            <CollapsiblePanel className="mt-3" title="Mais indicadores" description="Métricas complementares da banca e das estimativas">
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
                <MetricTile label="Banca inicial" value={money(data.summary.initialBankroll)} />
                <MetricTile label="Diferença para a odd perto do jogo" value={pct(data.summary.avgClv)} />
                <MetricTile label="Chance média calculada" value={pct(data.summary.avgPredicted)} />
                <MetricTile label="Maior queda da banca" value={pct(data.summary.maxDrawdown)} />
                <MetricTile label="Aguardando resultado" value={String(data.summary.pending)} />
              </div>
            </CollapsiblePanel>

            <section className="panel mt-4 p-4 sm:p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="label-eyebrow">Evolução da banca</p>
                  <h2 className="mt-1 text-lg font-semibold">Saldo ao longo do teste</h2>
                </div>
                <span className="text-xs text-muted-foreground">Máximo por sugestão: {pct(data.config.maxStakePct, 0)} da banca</span>
              </div>
              <BankrollChart points={data.bankrollSeries} />
            </section>

            <CollapsiblePanel className="mt-4" title="Como preencher" description="O que registrar em cada sugestão">
              <ol className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
                <li><span className="font-medium text-foreground">1. Odd escolhida.</span> Já é salva quando o sistema faz a sugestão.</li>
                <li><span className="font-medium text-foreground">2. Odd perto do jogo.</span> Registre a última odd disponível antes do início.</li>
                <li><span className="font-medium text-foreground">3. Resultado.</span> Depois do jogo, informe o valor realmente apostado e o desfecho.</li>
                <li><span className="font-medium text-foreground">4. Acompanhamento.</span> Avalie tendências somente quando houver amostra suficiente.</li>
              </ol>
            </CollapsiblePanel>

            <CollapsiblePanel className="mt-4" title="Por tipo de aposta" description="Veja quais categorias estão indo melhor" meta={data.byFamily.length}>
              {data.byFamily.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ainda não há sugestões registradas.</p>
              ) : (
                <>
                  <div className="hidden overflow-hidden rounded-lg border border-border md:block">
                    <table className="w-full border-collapse text-sm">
                      <thead><tr className="border-b border-border text-left"><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Sugestões</th><th className="px-4 py-3">Encerradas</th><th className="px-4 py-3">Acertos</th><th className="px-4 py-3">Retorno</th><th className="px-4 py-3">Diferença da odd</th></tr></thead>
                      <tbody>
                        {data.byFamily.map((family) => (
                          <tr key={family.family} className="border-b border-border/60 last:border-b-0"><td className="px-4 py-3 font-medium">{FAMILY_LABELS[family.family] ?? family.family}</td><td className="num px-4 py-3">{family.selections}</td><td className="num px-4 py-3">{family.settled}</td><td className="num px-4 py-3">{pct(family.hitRate)}</td><td className="num px-4 py-3">{pct(family.roi)}</td><td className="num px-4 py-3">{pct(family.avgClv)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="grid gap-2 md:hidden">
                    {data.byFamily.map((family) => (
                      <div key={family.family} className="metric-tile p-3"><div className="flex items-center justify-between gap-3"><p className="font-medium">{FAMILY_LABELS[family.family] ?? family.family}</p><p className="num text-sm">{pct(family.roi)}</p></div><p className="mt-1 text-xs text-muted-foreground">{family.selections} sugestões · {family.settled} encerradas · {pct(family.hitRate)} acertos</p></div>
                    ))}
                  </div>
                </>
              )}
            </CollapsiblePanel>

            <CollapsiblePanel className="mt-4" title="Chances calculadas x resultados" description="Compare a estimativa com o que aconteceu de verdade" meta={data.calibration.length}>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {data.calibration.map((bucket) => (
                  <div key={bucket.bucket} className="metric-tile p-3"><p className="font-medium">{bucket.bucket}</p><p className="mt-2 text-xs text-muted-foreground">{bucket.count} caso(s)</p><div className="mt-2 flex justify-between gap-3 text-sm"><span>Calculado <span className="num">{pct(bucket.predicted)}</span></span><span>Real <span className="num">{pct(bucket.observed)}</span></span></div></div>
                ))}
              </div>
            </CollapsiblePanel>

            <CollapsiblePanel className="mt-4" title="Histórico" description="Atualize odd perto do jogo, valor apostado e resultado" meta={recent.length}>
              {recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma sugestão registrada desde 08/09/2026.</p>
              ) : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="min-w-[1000px] w-full border-collapse text-sm">
                      <thead><tr className="border-b border-border text-left"><th className="px-3 py-3">Data</th><th className="px-3 py-3">Jogo / opção</th><th className="px-3 py-3">Chance</th><th className="px-3 py-3">Odd usada</th><th className="px-3 py-3">Odd perto do jogo</th><th className="px-3 py-3">Valor apostado</th><th className="px-3 py-3">Resultado</th><th className="px-3 py-3"></th></tr></thead>
                      <tbody>
                        {recent.map((row) => {
                          const draft = draftFor(row);
                          return (
                            <tr key={row.id} className="border-b border-border/60 align-top last:border-b-0">
                              <td className="num px-3 py-3 text-xs">{date(row.target_date)}</td>
                              <td className="px-3 py-3"><div className="font-medium">{row.match_label}</div><div className="mt-1 text-xs text-muted-foreground">{row.market_label}</div></td>
                              <td className="num px-3 py-3">{pct(Number(row.model_probability))}</td>
                              <td className="num px-3 py-3">{odd(row.entry_odd)}</td>
                              <td className="px-3 py-2"><Input inputMode="decimal" className="num w-24" value={draft.closingOdd} onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: { ...draft, closingOdd: event.target.value } }))} placeholder="1,70" /></td>
                              <td className="px-3 py-2"><Input inputMode="decimal" className="num w-24" value={draft.stake} onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: { ...draft, stake: event.target.value } }))} placeholder="R$" /></td>
                              <td className="px-3 py-2"><select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={draft.result} onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: { ...draft, result: event.target.value as Draft["result"] } }))}><option value="PENDING">Aguardando</option><option value="WIN">Ganhou</option><option value="LOSS">Perdeu</option><option value="PUSH">Devolvida</option><option value="VOID">Anulada</option></select></td>
                              <td className="px-3 py-2"><Button size="sm" variant="outline" disabled={savingId === row.id} onClick={() => void save(row)}>{savingId === row.id ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}<span className="ml-2">Salvar</span></Button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid gap-3 md:hidden">
                    {recent.map((row) => {
                      const draft = draftFor(row);
                      return (
                        <article key={row.id} className="metric-tile p-3">
                          <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] text-muted-foreground">{date(row.target_date)}</p><p className="mt-1 text-sm font-medium">{row.match_label}</p><p className="text-xs text-muted-foreground">{row.market_label}</p></div><div className="text-right"><p className="num text-sm">{pct(Number(row.model_probability))}</p><p className="num text-xs text-muted-foreground">odd {odd(row.entry_odd)}</p></div></div>
                          <div className="mt-3 grid grid-cols-2 gap-2"><label className="text-[11px] text-muted-foreground">Odd perto do jogo<Input inputMode="decimal" className="num mt-1" value={draft.closingOdd} onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: { ...draft, closingOdd: event.target.value } }))} placeholder="1,70" /></label><label className="text-[11px] text-muted-foreground">Valor apostado<Input inputMode="decimal" className="num mt-1" value={draft.stake} onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: { ...draft, stake: event.target.value } }))} placeholder="R$" /></label></div>
                          <div className="mt-2 grid grid-cols-[1fr_auto] gap-2"><select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={draft.result} onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: { ...draft, result: event.target.value as Draft["result"] } }))}><option value="PENDING">Aguardando</option><option value="WIN">Ganhou</option><option value="LOSS">Perdeu</option><option value="PUSH">Devolvida</option><option value="VOID">Anulada</option></select><Button className="min-h-10" size="sm" variant="outline" disabled={savingId === row.id} onClick={() => void save(row)}>{savingId === row.id ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}<span className="ml-2">Salvar</span></Button></div>
                          <p className="mt-2 text-[11px] text-muted-foreground">{friendlyResult(row.result)} · {row.profit_brl === null ? "resultado financeiro pendente" : money(Number(row.profit_brl))}</p>
                        </article>
                      );
                    })}
                  </div>
                </>
              )}
            </CollapsiblePanel>
          </>
        )}
      </div>
    </AppShell>
  );
}

function MetricCard({ label, value, hint, highlight = false }: { label: string; value: string; hint: string; highlight?: boolean }) {
  return (
    <div className={`panel p-3 sm:p-4 ${highlight ? "border-primary/30 bg-primary/8" : ""}`}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`num mt-1 text-xl font-semibold sm:text-2xl ${highlight ? "text-primary" : ""}`}>{value}</p>
      <p className="mt-1 text-[10px] text-muted-foreground sm:text-[11px]">{hint}</p>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return <div className="metric-tile p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="num mt-1 text-base font-medium">{value}</p></div>;
}

function BankrollChart({ points }: { points: Array<{ date: string; bankroll: number; label: string }> }) {
  if (points.length <= 1) {
    return <p className="mt-6 text-sm text-muted-foreground">A curva aparecerá quando houver resultados encerrados.</p>;
  }
  const values = points.map((point) => point.bankroll);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 0.01);
  const coords = points.map((point, index) => {
    const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
    const y = 92 - ((point.bankroll - min) / range) * 78;
    return `${x},${y}`;
  });
  return (
    <div className="mt-4">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-40 w-full overflow-visible text-primary sm:h-52" role="img" aria-label="Evolução da banca no modo de teste">
        <polyline points={coords.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>{date(points[0]?.date)}</span><span>{date(points.at(-1)?.date)}</span></div>
    </div>
  );
}
