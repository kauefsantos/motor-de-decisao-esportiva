import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, CircleAlert, Loader2, ShieldCheck } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { getDecisionObservability } from "@/lib/decision-observability.functions";

export const Route = createFileRoute("/diagnostico")({
  head: () => ({ meta: [{ title: "Diagnóstico do funil · Bet Value Engine" }] }),
  component: DecisionDiagnosticScreen,
});

function dateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

function Metric({ label, value, emphasis = false }: { label: string; value: string | number; emphasis?: boolean }) {
  return (
    <div className={`metric-tile p-3.5 ${emphasis ? "border-primary/30 bg-primary/[0.07]" : ""}`}>
      <p className="text-xs leading-4 text-muted-foreground">{label}</p>
      <p className={`num mt-1.5 text-2xl font-semibold ${emphasis ? "text-primary" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

function DecisionDiagnosticScreen() {
  const load = useServerFn(getDecisionObservability);
  const query = useQuery({
    queryKey: ["decision-observability"],
    queryFn: () => load(),
    refetchInterval: 15_000,
  });

  return (
    <AppShell stage="analytics">
      <div className="mx-auto max-w-5xl">
        <p className="label-eyebrow">Auditoria interna</p>
        <h1 className="page-heading mt-2">Funil de decisão</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Mostra quantas opções sobrevivem a cada barreira. É somente leitura e não altera probabilidades, odds, banca ou seleções.
        </p>

        {query.isLoading && (
          <div className="panel mt-5 flex items-center gap-3 p-4 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Conferindo a última análise…
          </div>
        )}

        {query.isError && (
          <div className="panel mt-5 border-destructive/30 p-4" role="alert">
            <p className="font-medium">Não foi possível montar o diagnóstico agora.</p>
            <Button className="mt-3 min-h-11 w-full sm:w-auto" variant="outline" onClick={() => void query.refetch()}>
              Tentar novamente
            </Button>
          </div>
        )}

        {query.data && (
          <>
            <section className={`mt-5 rounded-2xl border p-4 sm:p-5 ${query.data.isStrictValidation ? "border-success/25 bg-success/[0.06]" : "border-warning/25 bg-warning/[0.06]"}`}>
              <div className="flex items-start gap-3">
                {query.data.isStrictValidation ? (
                  <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
                ) : (
                  <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
                )}
                <div className="min-w-0">
                  <h2 className="font-semibold">
                    {query.data.isStrictValidation ? "Regra 70% + odd 1,70 + value" : "Aguardando a primeira validação real"}
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{query.data.note}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Régua ativa no código desde {dateTime(query.data.effectiveAt)}.</p>
                </div>
              </div>
            </section>

            {query.data.inspectedRun ? (
              <>
                <section className="panel mt-4 p-4 sm:p-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="label-eyebrow">Análise inspecionada</p>
                      <h2 className="mt-1 text-lg font-semibold">{query.data.inspectedRun.target_date ?? "Sem data"}</h2>
                    </div>
                    <div className="text-xs text-muted-foreground sm:text-right">
                      <p>{query.data.inspectedRun.status}</p>
                      <p>{dateTime(query.data.inspectedRun.created_at)}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Metric label="Jogos enviados" value={query.data.inspectedRun.matches_total ?? 0} />
                    <Metric label="Linhas centrais modeladas" value={query.data.funnel.anchorPredictions} />
                    <Metric label="Chance ≥ 70%" value={query.data.funnel.above70} emphasis />
                    <Metric label="Chance < 70%" value={query.data.funnel.rejectedAtOrBelow70} />
                  </div>
                </section>

                <section className="panel mt-4 p-4 sm:p-5">
                  <p className="label-eyebrow">Confiança do modelo</p>
                  <h2 className="mt-1 text-lg font-semibold">Distribuição das candidatas</h2>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Metric label="70% a <75%" value={query.data.funnel.bucket70To75} />
                    <Metric label="75% a <80%" value={query.data.funnel.bucket75To80} />
                    <Metric label="80% a <85%" value={query.data.funnel.bucket80To85} />
                    <Metric label="85% ou mais" value={query.data.funnel.bucket85Plus} />
                  </div>
                </section>

                <section className="panel mt-4 p-4 sm:p-5">
                  <p className="label-eyebrow">Preço e value</p>
                  <h2 className="mt-1 text-lg font-semibold">Da Bet365 até o portfólio final</h2>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Metric label="Odds automáticas ≥ 1,70" value={query.data.funnel.automaticOddFloorPass} />
                    <Metric label="EV ≥ 8% + edge ≥ 5 p.p." value={query.data.funnel.automaticEvPass} />
                    <Metric label="Sugestões finais" value={query.data.funnel.selected} emphasis />
                    <Metric label="Limite da rodada" value={query.data.selectionLimit} />
                  </div>

                  <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                    <div className="metric-tile flex items-center justify-between gap-3 p-3">
                      <span className="text-muted-foreground">Cotação indevida abaixo de 70%</span>
                      <span className={`num font-semibold ${query.data.isStrictValidation && query.data.funnel.pricedAtOrBelow70 === 0 ? "text-success" : "text-foreground"}`}>
                        {query.data.funnel.pricedAtOrBelow70}
                      </span>
                    </div>
                    <div className="metric-tile flex items-center justify-between gap-3 p-3">
                      <span className="text-muted-foreground">Seleção fora da régua final</span>
                      <span className={`num font-semibold ${query.data.isStrictValidation && query.data.funnel.selectedOutsideRule === 0 ? "text-success" : "text-foreground"}`}>
                        {query.data.funnel.selectedOutsideRule}
                      </span>
                    </div>
                    <div className="metric-tile flex items-center justify-between gap-3 p-3">
                      <span className="text-muted-foreground">Linha diferente da modelada</span>
                      <span className="num font-semibold">{query.data.funnel.lineMismatch}</span>
                    </div>
                    <div className="metric-tile flex items-center justify-between gap-3 p-3">
                      <span className="text-muted-foreground">Sem preço / fonte indisponível</span>
                      <span className="num font-semibold">{query.data.funnel.noPrice + query.data.funnel.sourceUnavailable}</span>
                    </div>
                  </div>

                  {query.data.isStrictValidation && (
                    <div className="mt-4 grid gap-2">
                      <div className="flex items-start gap-2 rounded-xl bg-secondary/30 p-3 text-sm">
                        <CheckCircle2 className={`mt-0.5 size-4 shrink-0 ${query.data.health.noLowProbabilityPriceLeak ? "text-success" : "text-destructive"}`} aria-hidden />
                        <p className="text-muted-foreground">
                          {query.data.health.noLowProbabilityPriceLeak
                            ? "Nenhuma opção abaixo de 70% chegou à cotação automática nesta análise."
                            : "Foi detectada cotação de opção abaixo de 70%. Isso exige revisão antes de usar a seleção."}
                        </p>
                      </div>
                      <div className="flex items-start gap-2 rounded-xl bg-secondary/30 p-3 text-sm">
                        <CheckCircle2 className={`mt-0.5 size-4 shrink-0 ${query.data.health.noSelectionOutsideRule ? "text-success" : "text-destructive"}`} aria-hidden />
                        <p className="text-muted-foreground">
                          {query.data.health.noSelectionOutsideRule
                            ? "Nenhuma seleção persistida viola chance ≥ 70%, odd ≥ 1,70, EV ≥ 8% e edge ≥ 5 p.p."
                            : "Foi detectada uma seleção persistida fora da régua quantitativa. O resultado deve ser tratado como inválido até revisão."}
                        </p>
                      </div>
                    </div>
                  )}
                </section>

                <section className="mt-4 rounded-xl bg-secondary/20 p-4 text-sm text-muted-foreground">
                  <p>
                    <strong className="font-medium text-foreground">Leitura correta:</strong> o backend avalia a rodada inteira. Apenas oportunidades com chance ≥ 70%, odd ≥ 1,70, EV ≥ 8%, edge ≥ 5 p.p., dados utilizáveis e linha compatível podem chegar ao portfólio; o sistema retorna de zero a três escolhas e nunca cria uma aposta apenas para preencher a tela.
                  </p>
                </section>
              </>
            ) : (
              <div className="panel mt-4 p-5 text-sm text-muted-foreground">Ainda não existem análises para auditar.</div>
            )}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Button asChild className="min-h-11 w-full sm:w-auto">
                <Link to="/">Nova análise</Link>
              </Button>
              <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto">
                <Link to="/analytics">Voltar ao desempenho</Link>
              </Button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
