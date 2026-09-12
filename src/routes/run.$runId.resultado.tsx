import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2, TriangleAlert } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { BetConfirmationFlow } from "@/components/BetConfirmationFlow";
import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { MetricHelp } from "@/components/MetricHelp";
import { Button } from "@/components/ui/button";
import { getExperimentalBetPlan } from "@/lib/bankroll.functions";

export const Route = createFileRoute("/run/$runId/resultado")({
  validateSearch: (search: Record<string, unknown>) => ({
    mode: search["mode"] === "experimental" ? ("experimental" as const) : undefined,
  }),
  head: () => ({ meta: [{ title: "Revisar e registrar · Bet Value Engine" }] }),
  component: ResultScreen,
});

const pct = (value: unknown, digits = 1) =>
  value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(digits)}%`;
const dec = (value: unknown) =>
  value === null || value === undefined ? "—" : Number(value).toFixed(2);

function dateLabel(iso: string | null | undefined) {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

type ResultRow = {
  id: string;
  prediction_id: string;
  target_date: string | null;
  match_label: string;
  competition: string | null;
  market_label: string;
  model_probability: number | string;
  entry_odd: number | string;
  fair_odd?: number | string | null;
  min_odd_target?: number | string | null;
  edge: number | string | null;
  expected_value: number | string | null;
  bet_status: "PROPOSED" | "OPEN" | "DECLINED" | "SETTLED";
  selection_rank: number | null;
  stake_brl: number | string | null;
};

function statusLabel(status: ResultRow["bet_status"]) {
  if (status === "PROPOSED") return "Aguardando registro";
  if (status === "OPEN") return "Registrada · em andamento";
  if (status === "SETTLED") return "Encerrada";
  return "Descartada";
}

function ResultScreen() {
  const { runId } = Route.useParams();
  const loadPlan = useServerFn(getExperimentalBetPlan);
  const query = useQuery({
    queryKey: ["experimental-bet-plan", runId],
    queryFn: () => loadPlan({ data: { runId } }),
  });

  const rows = (query.data?.all ?? []) as ResultRow[];
  const selected = rows
    .filter((row) => row.bet_status !== "DECLINED")
    .sort((a, b) => (a.selection_rank ?? 999) - (b.selection_rank ?? 999) || Number(b.expected_value ?? 0) - Number(a.expected_value ?? 0));
  const declined = rows.filter((row) => row.bet_status === "DECLINED");
  const targetDate = selected[0]?.target_date ?? rows[0]?.target_date ?? null;

  return (
    <AppShell stage="resultado">
      <div className="mx-auto max-w-5xl">
        <p className="label-eyebrow">Etapa 4 de 4 · revisar e registrar</p>
        <h1 className="page-heading mt-2">Revise suas escolhas</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Confira jogo, mercado, odd, chance e EV esperado. Depois registre somente as apostas que você realmente fizer.
        </p>

        {query.data && (
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 rounded-xl bg-secondary/25 px-4 py-3 text-xs text-muted-foreground ring-1 ring-border/45">
            <span>Rodada <strong className="font-medium text-foreground">{dateLabel(targetDate)}</strong></span>
            <span>{selected.length} escolha{selected.length === 1 ? "" : "s"}</span>
            <span>{query.data.proposedCount} aguardando registro</span>
            <span>{query.data.openCount} em andamento</span>
          </div>
        )}

        {query.isLoading && (
          <div className="panel mt-6 flex items-center gap-3 p-5 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" /> Recuperando suas escolhas…
          </div>
        )}

        {query.isError && (
          <div className="panel mt-6 border-destructive/30 p-5" role="alert">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Não foi possível recuperar suas escolhas</p>
                <p className="mt-1 text-sm text-muted-foreground">Isso é uma falha de carregamento, não significa que a análise terminou sem opções.</p>
                {query.error instanceof Error && <p className="mt-2 text-xs text-destructive">{query.error.message}</p>}
                <Button className="mt-4" variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button>
              </div>
            </div>
          </div>
        )}

        {!query.isLoading && !query.isError && rows.length === 0 && (
          <div className="panel mt-6 p-5">
            <p className="font-medium">Nenhuma escolha foi registrada para esta rodada.</p>
            <p className="mt-1 text-sm text-muted-foreground">Volte às opções para conferir a análise. Nenhuma sugestão é criada apenas para preencher espaço.</p>
            <Button asChild className="mt-4" variant="outline"><Link to="/run/$runId/oportunidades" params={{ runId }}>Voltar às opções</Link></Button>
          </div>
        )}

        {!query.isError && selected.length > 0 && (
          <div className="mt-6 grid gap-4">
            {selected.map((row, index) => (
              <article key={row.id} className="panel overflow-hidden">
                <div className="p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="label-eyebrow">Escolha {row.selection_rank ?? index + 1}</p>
                      <h2 className="mt-1 text-lg font-semibold sm:text-xl">{row.match_label}</h2>
                      <p className="mt-0.5 text-sm text-muted-foreground">{row.market_label}</p>
                      <p className="mt-2 text-xs text-muted-foreground">{statusLabel(row.bet_status)}</p>
                    </div>
                    <dl className="grid grid-cols-3 gap-4 sm:min-w-80 sm:text-right">
                      <div><dt className="text-[11px] text-muted-foreground">Odd</dt><dd className="num mt-1 text-lg font-semibold">{dec(row.entry_odd)}</dd></div>
                      <div><dt className="text-[11px] text-muted-foreground">Chance</dt><dd className="num mt-1 text-lg font-semibold">{pct(row.model_probability)}</dd></div>
                      <div><dt className="flex items-center justify-end text-[11px] text-muted-foreground">EV esperado <MetricHelp term="EV" /></dt><dd className="num mt-1 text-lg font-semibold text-success">{pct(row.expected_value)}</dd></div>
                    </dl>
                  </div>
                </div>

                <CollapsiblePanel className="m-3 mt-0 bg-transparent shadow-none sm:m-4 sm:mt-0" title="Ver detalhes da análise" description="Preço de referência, vantagem e identificação técnica">
                  <div className="grid gap-3 text-sm sm:grid-cols-3">
                    <p><span className="inline-flex items-center text-muted-foreground">Odd de referência <MetricHelp term="Odd de referência" /></span><br /><span className="num font-medium">{dec(row.fair_odd)}</span></p>
                    <p><span className="inline-flex items-center text-muted-foreground">Vantagem <MetricHelp term="Vantagem" /></span><br /><span className="num font-medium">{pct(row.edge)}</span></p>
                    <p><span className="text-muted-foreground">Odd mínima</span><br /><span className="num font-medium">{dec(row.min_odd_target)}</span></p>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">Referência interna: <span className="num">{row.prediction_id}</span></p>
                </CollapsiblePanel>
              </article>
            ))}
          </div>
        )}

        {!query.isError && declined.length > 0 && (
          <CollapsiblePanel className="mt-4" title="Sugestões descartadas" description="Opções revisadas que você decidiu não registrar" meta={declined.length}>
            <ul className="divide-y divide-border">
              {declined.map((row) => (
                <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium">{row.match_label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{row.market_label} · odd {dec(row.entry_odd)}</p>
                </li>
              ))}
            </ul>
          </CollapsiblePanel>
        )}

        {!query.isError && rows.length > 0 && <BetConfirmationFlow runId={runId} />}

        <div className="mt-6 border-t border-border pt-5">
          <p className="mb-3 text-xs text-muted-foreground">Outras ações</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild variant="outline"><Link to="/">Nova análise</Link></Button>
            <Button asChild variant="outline"><Link to="/open-bets">Em andamento</Link></Button>
            <Button asChild variant="ghost"><Link to="/analytics">Ver desempenho</Link></Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
