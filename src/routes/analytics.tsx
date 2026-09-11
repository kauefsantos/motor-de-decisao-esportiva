import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Loader2, TriangleAlert } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { Button } from "@/components/ui/button";
import { getExperimentalAnalytics } from "@/lib/analytics.functions";

export const Route = createFileRoute("/analytics")({
  head: () => ({ meta: [{ title: "Desempenho · Bet Value Engine" }] }),
  component: AnalyticsScreen,
});

type AnalyticsData = Awaited<ReturnType<typeof getExperimentalAnalytics>>;

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
  CARDS: "Cartões",
  GOALS: "Gols da partida",
  TEAM_GOALS: "Gols por time",
  TEAM_CARDS: "Cartões por time",
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
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["experimental-analytics"],
    queryFn: () => fetchAnalytics(),
  });

  const recent = useMemo(() => (data?.rows ?? []).slice(0, 80), [data]);

  return (
    <AppShell stage="analytics">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="label-eyebrow">Acompanhamento</p>
            <h1 className="page-heading mt-1.5">Como as sugestões estão se saindo?</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Esta tela é somente para acompanhar banca, resultados e qualidade das estimativas.
            </p>
          </div>
          <Button asChild variant="outline" className="min-h-12 w-full shrink-0 sm:min-h-11 sm:w-auto">
            <Link to="/open-bets">Registrar resultados</Link>
          </Button>
        </div>

        {isLoading && (
          <div className="panel mt-5 flex items-center gap-3 p-5 text-sm text-muted-foreground sm:mt-6">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando o desempenho…
          </div>
        )}

        {isError && (
          <div className="panel mt-5 border-destructive/30 p-5 sm:mt-6">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Não foi possível carregar o desempenho.</p>
                {error instanceof Error && <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>}
                <Button className="mt-4 min-h-12 w-full sm:min-h-11 sm:w-auto" variant="outline" onClick={() => void refetch()}>
                  Tentar novamente
                </Button>
              </div>
            </div>
          </div>
        )}

        {data && (
          <>
            <div className="mt-5 grid grid-cols-1 gap-2 min-[390px]:grid-cols-2 lg:mt-6 lg:grid-cols-4">
              <MetricCard label="Banca atual" value={money(data.summary.currentBankroll)} hint={`Resultado: ${money(data.summary.totalProfit)}`} highlight />
              <MetricCard label="Resultado acumulado" value={money(data.summary.totalProfit)} hint={`Desde ${date(data.config.startDate)}`} />
              <MetricCard label="Retorno sobre o valor apostado" value={pct(data.summary.roi)} hint={`${data.summary.settled} encerrada(s)`} />
              <MetricCard label="Taxa de acerto" value={pct(data.summary.hitRate)} hint={`${data.summary.wins} ganhos · ${data.summary.losses} perdas`} />
            </div>

            <p className="mt-3 rounded-xl bg-secondary/25 px-4 py-3 text-sm leading-relaxed text-muted-foreground ring-1 ring-border/45">
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
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
                <div>
                  <p className="label-eyebrow">Evolução da banca</p>
                  <h2 className="mt-1 text-lg font-semibold">Saldo ao longo do teste</h2>
                </div>
                <span className="text-xs text-muted-foreground">Máximo por sugestão: {pct(data.config.maxStakePct, 0)} da banca</span>
              </div>
              <BankrollChart points={data.bankrollSeries} />
            </section>

            <div className="mt-4 rounded-xl bg-secondary/25 px-4 py-3 text-sm leading-relaxed text-muted-foreground ring-1 ring-border/45">
              Para encerrar uma aposta, use <Link to="/open-bets" className="font-medium text-accent underline underline-offset-4">Em andamento</Link>. O histórico abaixo é somente leitura para evitar dois lugares diferentes alterando o mesmo resultado.
            </div>

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
                      <div key={family.family} className="metric-tile p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium">{FAMILY_LABELS[family.family] ?? family.family}</p>
                          <p className="num text-lg font-semibold text-primary">{pct(family.roi)}</p>
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{family.selections} sugestões · {family.settled} encerradas · {pct(family.hitRate)} acertos</p>
                      </div>
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

            <CollapsiblePanel className="mt-4" title="Histórico" description="Registro consolidado; resultados são alterados apenas em Em andamento" meta={recent.length}>
              {recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma sugestão registrada desde 08/09/2026.</p>
              ) : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="min-w-[960px] w-full border-collapse text-sm">
                      <thead><tr className="border-b border-border text-left"><th className="px-3 py-3">Data</th><th className="px-3 py-3">Jogo / opção</th><th className="px-3 py-3">Chance</th><th className="px-3 py-3">Odd entrada</th><th className="px-3 py-3">Odd final</th><th className="px-3 py-3">Valor</th><th className="px-3 py-3">Resultado</th><th className="px-3 py-3">Financeiro</th></tr></thead>
                      <tbody>
                        {recent.map((row) => (
                          <tr key={row.id} className="border-b border-border/60 align-top last:border-b-0">
                            <td className="num px-3 py-3 text-xs">{date(row.target_date)}</td>
                            <td className="px-3 py-3"><div className="font-medium">{row.match_label}</div><div className="mt-1 text-xs text-muted-foreground">{row.market_label}</div></td>
                            <td className="num px-3 py-3">{pct(Number(row.model_probability))}</td>
                            <td className="num px-3 py-3">{odd(row.entry_odd)}</td>
                            <td className="num px-3 py-3">{odd(row.closing_odd)}</td>
                            <td className="num px-3 py-3">{row.stake_brl === null ? "—" : money(Number(row.stake_brl))}</td>
                            <td className="px-3 py-3">{friendlyResult(row.result)}</td>
                            <td className="num px-3 py-3">{row.profit_brl === null ? "—" : money(Number(row.profit_brl))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid gap-3 md:hidden">
                    {recent.map((row) => (
                      <article key={row.id} className="rounded-xl bg-secondary/30 p-4 ring-1 ring-border/45">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">{date(row.target_date)}</p>
                            <p className="mt-1 text-sm font-medium leading-snug">{row.match_label}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{row.market_label}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="num text-lg font-semibold text-primary">{pct(Number(row.model_probability))}</p>
                            <p className="num text-xs text-muted-foreground">odd {odd(row.entry_odd)}</p>
                          </div>
                        </div>
                        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div className="metric-tile p-2.5"><dt className="text-muted-foreground">Odd final</dt><dd className="num mt-1 text-sm font-medium">{odd(row.closing_odd)}</dd></div>
                          <div className="metric-tile p-2.5"><dt className="text-muted-foreground">Valor</dt><dd className="num mt-1 text-sm font-medium">{row.stake_brl === null ? "—" : money(Number(row.stake_brl))}</dd></div>
                          <div className="metric-tile p-2.5"><dt className="text-muted-foreground">Resultado</dt><dd className="mt-1 text-sm font-medium">{friendlyResult(row.result)}</dd></div>
                          <div className="metric-tile p-2.5"><dt className="text-muted-foreground">Financeiro</dt><dd className="num mt-1 text-sm font-medium">{row.profit_brl === null ? "—" : money(Number(row.profit_brl))}</dd></div>
                        </dl>
                      </article>
                    ))}
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
    <div className={`panel p-4 ${highlight ? "border-primary/25 bg-primary/[0.055]" : ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`num mt-1 text-2xl font-semibold tracking-tight ${highlight ? "text-primary" : ""}`}>{value}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return <div className="metric-tile p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="num mt-1 text-base font-medium">{value}</p></div>;
}

function BankrollChart({ points }: { points: Array<{ date: string; bankroll: number; label: string }> }) {
  if (points.length <= 1) {
    return <p className="mt-6 text-sm text-muted-foreground">A curva aparecerá quando houver resultados encerrados.</p>;
  }

  const values = points.map((point) => point.bankroll);
  const start = values[0] ?? 0;
  const current = values.at(-1) ?? start;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 0.01);
  const yFor = (value: number) => 90 - ((value - min) / range) * 72;
  const coords = points.map((point, index) => {
    const x = 2 + (index / (points.length - 1)) * 96;
    return `${x},${yFor(point.bankroll)}`;
  });
  const startY = yFor(start);

  return (
    <div className="mt-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricTile label="Início" value={money(start)} />
        <MetricTile label="Atual" value={money(current)} />
        <MetricTile label="Menor saldo" value={money(min)} />
        <MetricTile label="Maior saldo" value={money(max)} />
      </div>
      <div className="mt-3 rounded-xl bg-secondary/15 p-3 ring-1 ring-border/45">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-44 w-full overflow-visible text-primary sm:h-52" role="img" aria-label={`Evolução da banca de ${money(start)} para ${money(current)}; mínimo ${money(min)} e máximo ${money(max)}`}>
          <line x1="0" x2="100" y1={startY} y2={startY} stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" opacity="0.25" vectorEffect="non-scaling-stroke" />
          <polyline points={coords.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
          {points.map((point, index) => (
            <circle key={`${point.date}-${index}`} cx={2 + (index / (points.length - 1)) * 96} cy={yFor(point.bankroll)} r="1.2" fill="currentColor" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{date(points[0]?.date)}</span><span>{date(points.at(-1)?.date)}</span></div>
        <p className="mt-2 text-xs text-muted-foreground">A linha tracejada marca o saldo inicial.</p>
      </div>
    </div>
  );
}
