import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, TriangleAlert } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { BetConfirmationFlow } from "@/components/BetConfirmationFlow";
import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { Button } from "@/components/ui/button";
import { getExperimentalBetPlan } from "@/lib/bankroll.functions";

export const Route = createFileRoute("/run/$runId/resultado")({
  validateSearch: (search: Record<string, unknown>) => ({
    mode: search["mode"] === "experimental" ? ("experimental" as const) : undefined,
  }),
  head: () => ({ meta: [{ title: "Revisar escolhas · Bet Value" }] }),
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
  if (status === "PROPOSED") return "Ainda não registrada";
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
      <div className="mx-auto max-w-4xl">
        <div>
          <p className="label-eyebrow">Última etapa</p>
          <h1 className="page-heading mt-1.5">Revise o que você escolheu</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Confira jogo, mercado e odd. Depois registre apenas o que você realmente apostou.
          </p>
        </div>

        {query.data && (
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Rodada <strong className="font-medium text-foreground">{dateLabel(targetDate)}</strong></span>
            <span>{selected.length} escolha{selected.length === 1 ? "" : "s"}</span>
            {query.data.openCount > 0 && <span>{query.data.openCount} em andamento</span>}
          </div>
        )}

        {query.isLoading && (
          <div className="panel mt-6 flex items-center gap-3 p-5 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando suas escolhas…
          </div>
        )}

        {query.isError && (
          <div className="panel mt-6 border-destructive/30 p-5" role="alert">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Não foi possível carregar suas escolhas</p>
                <p className="mt-1 text-sm text-muted-foreground">A análise continua salva. Tente carregar esta tela novamente.</p>
                <Button className="mt-4" variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button>
              </div>
            </div>
          </div>
        )}

        {!query.isLoading && !query.isError && rows.length === 0 && (
          <section className="panel mt-6 p-5 sm:p-6">
            <h2 className="text-lg font-semibold">Nenhuma escolha nesta rodada</h2>
            <p className="mt-1 text-sm text-muted-foreground">A análise terminou sem opções selecionadas. Isso é válido e não indica erro.</p>
            <Button asChild className="mt-4" variant="outline"><Link to="/">Voltar ao início</Link></Button>
          </section>
        )}

        {!query.isError && selected.length > 0 && (
          <div className="mt-6 grid gap-3">
            {selected.map((row, index) => (
              <article key={row.id} className="panel p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Escolha {row.selection_rank ?? index + 1} · {statusLabel(row.bet_status)}</p>
                    <h2 className="mt-1 text-lg font-semibold">{row.match_label}</h2>
                    <p className="mt-1 text-sm text-foreground/80">{row.market_label}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <div className="rounded-xl bg-secondary/35 px-3 py-2 text-center">
                      <p className="text-[11px] text-muted-foreground">Odd</p>
                      <p className="num mt-0.5 font-semibold">{dec(row.entry_odd)}</p>
                    </div>
                    <div className="rounded-xl bg-secondary/35 px-3 py-2 text-center">
                      <p className="text-[11px] text-muted-foreground">Chance</p>
                      <p className="num mt-0.5 font-semibold">{pct(row.model_probability)}</p>
                    </div>
                  </div>
                </div>

                <details className="mt-3 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                  <summary className="touch-target flex min-h-9 cursor-pointer list-none items-center font-medium text-foreground/80">Ver números da análise</summary>
                  <div className="grid gap-2 pb-1 sm:grid-cols-4">
                    <p>Valor esperado<br /><strong className="num text-foreground">{pct(row.expected_value)}</strong></p>
                    <p>Vantagem<br /><strong className="num text-foreground">{pct(row.edge)}</strong></p>
                    <p>Odd de referência<br /><strong className="num text-foreground">{dec(row.fair_odd)}</strong></p>
                    <p>Odd mínima<br /><strong className="num text-foreground">{dec(row.min_odd_target)}</strong></p>
                  </div>
                </details>
              </article>
            ))}
          </div>
        )}

        {!query.isError && declined.length > 0 && (
          <CollapsiblePanel className="mt-4" title="Opções descartadas" description="O que você decidiu não acompanhar" meta={declined.length}>
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

        <details className="mt-6 border-t border-border pt-4">
          <summary className="touch-target flex min-h-11 cursor-pointer list-none items-center text-sm font-medium">Outras ações</summary>
          <div className="flex flex-col gap-2 pb-2 sm:flex-row">
            <Button asChild variant="outline"><Link to="/">Nova análise</Link></Button>
            <Button asChild variant="outline"><Link to="/open-bets">Em andamento</Link></Button>
            <Button asChild variant="ghost"><Link to="/analytics">Ver desempenho</Link></Button>
          </div>
        </details>
      </div>
    </AppShell>
  );
}
