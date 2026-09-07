import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getExperimentalAnalytics,
  updateExperimentalTracking,
} from "@/lib/analytics.functions";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Desempenho · Bet Value Engine" },
      {
        name: "description",
        content: "Acompanhe banca, resultados, retorno, preço de fechamento e desempenho por mercado.",
      },
    ],
  }),
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
  if (result === "PUSH") return "Devolvida";
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
    const closingOdd =
      draft.closingOdd.trim() === "" ? null : Number(draft.closingOdd.replace(",", "."));
    if (stake !== null && (!Number.isFinite(stake) || stake < 0)) {
      toast.error("Confira o valor usado.");
      return;
    }
    if (closingOdd !== null && (!Number.isFinite(closingOdd) || closingOdd <= 1)) {
      toast.error("Confira a odd de fechamento.");
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
      <p className="label-eyebrow">Acompanhamento</p>
      <h1 className="mt-2 text-3xl font-bold">Como o modelo está se saindo?</h1>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        Este painel acompanha o modo de teste a partir de 08/09/2026. A ideia é medir com calma se as
        probabilidades, os preços encontrados e os resultados melhoram de forma consistente ao longo do tempo.
      </p>

      {isLoading && (
        <div className="panel mt-8 flex items-center gap-3 p-8 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando acompanhamento…
        </div>
      )}

      {data && (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Banca inicial" value={money(data.summary.initialBankroll)} hint={`Desde ${date(data.config.startDate)}`} />
            <MetricCard label="Banca atual" value={money(data.summary.currentBankroll)} hint={`Saldo: ${money(data.summary.totalProfit)}`} />
            <MetricCard label="Retorno sobre o valor usado" value={pct(data.summary.roi)} hint={`${data.summary.settled} resultado(s) fechado(s)`} />
            <MetricCard label="Preço de fechamento" value={pct(data.summary.avgClv)} hint={`${data.summary.withClosingOdd} registro(s) com odd final`} />
            <MetricCard label="Acertos" value={pct(data.summary.hitRate)} hint={`${data.summary.wins} ganhos · ${data.summary.losses} perdas`} />
            <MetricCard label="Probabilidade média" value={pct(data.summary.avgPredicted)} hint="Das seleções já encerradas" />
            <MetricCard label="Maior queda da banca" value={pct(data.summary.maxDrawdown)} hint="Do melhor saldo até o pior ponto seguinte" />
            <MetricCard label="Aguardando resultado" value={String(data.summary.pending)} hint={`${data.summary.selections} seleção(ões) acompanhada(s)`} />
          </div>

          <div className="panel mt-6 p-6">
            <p className="label-eyebrow">Leitura do momento</p>
            <p className="mt-2 text-sm text-muted-foreground">{data.summary.sampleMessage}</p>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
            <section className="panel p-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="label-eyebrow">Evolução da banca</p>
                  <h2 className="mt-1 text-lg font-semibold">Saldo ao longo do piloto</h2>
                </div>
                <span className="text-xs text-muted-foreground">
                  Limite de exposição configurado: {pct(data.config.maxStakePct, 0)} por seleção
                </span>
              </div>
              <BankrollChart points={data.bankrollSeries} />
            </section>

            <aside className="panel p-6">
              <p className="label-eyebrow">Protocolo</p>
              <h2 className="mt-1 text-lg font-semibold">O que registrar em cada seleção</h2>
              <ol className="mt-4 space-y-3 text-sm text-muted-foreground">
                <li><span className="font-medium text-foreground">1. Entrada.</span> A odd escolhida já é salva automaticamente quando o sistema seleciona o mercado.</li>
                <li><span className="font-medium text-foreground">2. Fechamento.</span> Perto do início do jogo, registre a última odd disponível para comparar preço.</li>
                <li><span className="font-medium text-foreground">3. Resultado.</span> Depois do jogo, informe o valor realmente usado e marque o desfecho.</li>
                <li><span className="font-medium text-foreground">4. Revisão.</span> Acompanhe retorno, calibração e mercados separadamente. Não tire conclusões com poucos casos.</li>
              </ol>
            </aside>
          </div>

          <section className="panel mt-6 overflow-hidden">
            <div className="border-b border-border px-6 py-4">
              <p className="label-eyebrow">Por tipo de mercado</p>
              <h2 className="mt-1 text-lg font-semibold">Onde o desempenho está vindo</h2>
            </div>
            {data.byFamily.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">Ainda não há seleções registradas desde o início do acompanhamento.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="px-6 py-3">Mercado</th>
                      <th className="px-6 py-3">Seleções</th>
                      <th className="px-6 py-3">Encerradas</th>
                      <th className="px-6 py-3">Acertos</th>
                      <th className="px-6 py-3">Retorno</th>
                      <th className="px-6 py-3">Preço de fechamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byFamily.map((family) => (
                      <tr key={family.family} className="border-b border-border/60 last:border-b-0">
                        <td className="px-6 py-3 font-medium">{FAMILY_LABELS[family.family] ?? family.family}</td>
                        <td className="num px-6 py-3">{family.selections}</td>
                        <td className="num px-6 py-3">{family.settled}</td>
                        <td className="num px-6 py-3">{pct(family.hitRate)}</td>
                        <td className="num px-6 py-3">{pct(family.roi)}</td>
                        <td className="num px-6 py-3">{pct(family.avgClv)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel mt-6 overflow-hidden">
            <div className="border-b border-border px-6 py-4">
              <p className="label-eyebrow">Probabilidade x resultado</p>
              <h2 className="mt-1 text-lg font-semibold">As chances estimadas estão batendo com a realidade?</h2>
            </div>
            <div className="grid gap-4 p-6 sm:grid-cols-2 xl:grid-cols-4">
              {data.calibration.map((bucket) => (
                <div key={bucket.bucket} className="rounded-lg border border-border p-4">
                  <p className="font-medium">{bucket.bucket}</p>
                  <p className="mt-3 text-xs text-muted-foreground">Casos: {bucket.count}</p>
                  <p className="mt-1 text-sm">Previsto: <span className="num">{pct(bucket.predicted)}</span></p>
                  <p className="mt-1 text-sm">Aconteceu: <span className="num">{pct(bucket.observed)}</span></p>
                </div>
              ))}
            </div>
          </section>

          <section className="panel mt-6 overflow-hidden">
            <div className="border-b border-border px-6 py-4">
              <p className="label-eyebrow">Histórico</p>
              <h2 className="mt-1 text-lg font-semibold">Fechar e revisar seleções</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                A odd de fechamento e o valor usado são preenchidos por você. O lucro ou prejuízo é calculado a partir do resultado marcado.
              </p>
            </div>
            {recent.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">Nenhuma seleção registrada desde 08/09/2026.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[1150px] w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="px-4 py-3">Data</th>
                      <th className="px-4 py-3">Jogo / mercado</th>
                      <th className="px-4 py-3">Chance</th>
                      <th className="px-4 py-3">Odd entrada</th>
                      <th className="px-4 py-3">Odd final</th>
                      <th className="px-4 py-3">Valor usado</th>
                      <th className="px-4 py-3">Resultado</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((row) => {
                      const draft = draftFor(row);
                      return (
                        <tr key={row.id} className="border-b border-border/60 align-top last:border-b-0">
                          <td className="px-4 py-4 num text-xs">{date(row.target_date)}</td>
                          <td className="px-4 py-4">
                            <div className="font-medium">{row.match_label}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{row.market_label}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">{friendlyResult(row.result)} · {row.profit_brl === null ? "saldo pendente" : money(Number(row.profit_brl))}</div>
                          </td>
                          <td className="num px-4 py-4">{pct(Number(row.model_probability))}</td>
                          <td className="num px-4 py-4">{odd(row.entry_odd)}</td>
                          <td className="px-4 py-3">
                            <Input
                              inputMode="decimal"
                              className="num w-24"
                              value={draft.closingOdd}
                              onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: { ...draft, closingOdd: event.target.value } }))}
                              placeholder="ex. 1,70"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <Input
                              inputMode="decimal"
                              className="num w-24"
                              value={draft.stake}
                              onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: { ...draft, stake: event.target.value } }))}
                              placeholder="R$"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <select
                              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                              value={draft.result}
                              onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: { ...draft, result: event.target.value as Draft["result"] } }))}
                            >
                              <option value="PENDING">Aguardando</option>
                              <option value="WIN">Ganhou</option>
                              <option value="LOSS">Perdeu</option>
                              <option value="PUSH">Devolvida</option>
                              <option value="VOID">Anulada</option>
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <Button size="sm" variant="outline" disabled={savingId === row.id} onClick={() => void save(row)}>
                              {savingId === row.id ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                              <span className="ml-2">Salvar</span>
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="panel p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="num mt-2 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function BankrollChart({ points }: { points: Array<{ date: string; bankroll: number; label: string }> }) {
  if (points.length <= 1) {
    return <p className="mt-8 text-sm text-muted-foreground">A curva aparecerá quando houver resultados encerrados.</p>;
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
    <div className="mt-6">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-48 w-full overflow-visible text-primary" role="img" aria-label="Evolução da banca experimental">
        <polyline points={coords.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        <span>{date(points[0]?.date)}</span>
        <span>{date(points.at(-1)?.date)}</span>
      </div>
    </div>
  );
}
