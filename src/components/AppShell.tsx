import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { BarChart3, Clock3, LogOut, Search, ShieldCheck } from "lucide-react";

import { BetConfirmationFlow } from "@/components/BetConfirmationFlow";
import { supabase } from "@/integrations/supabase/client";

const STAGES = [
  { key: "upload", label: "Enviar jogos", shortLabel: "Enviar" },
  { key: "processamento", label: "Preparar", shortLabel: "Preparar" },
  { key: "oportunidades", label: "Conferir odds", shortLabel: "Odds" },
  { key: "resultado", label: "Ver sugestões", shortLabel: "Sugestões" },
] as const;

type StageKey = (typeof STAGES)[number]["key"] | "open-bets" | "analytics" | "account";

export function AppShell({ stage, children }: { stage: StageKey; children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const resultMatch = pathname.match(/^\/run\/([0-9a-f-]+)\/resultado$/i);
  const resultRunId = resultMatch?.[1] ?? null;
  const showAnalysisProgress = STAGES.some((item) => item.key === stage);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.assign("/");
  }

  const mobileNavClass = (active: boolean) =>
    `flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[11px] font-medium transition-colors ${
      active ? "bg-primary/12 text-primary" : "text-muted-foreground active:bg-secondary/70"
    }`;

  const desktopNavClass = (active: boolean) =>
    `flex min-h-9 items-center justify-center rounded-lg px-3.5 text-xs font-medium transition-colors ${
      active
        ? "bg-background text-foreground shadow-sm ring-1 ring-border"
        : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
    }`;

  return (
    <div className="min-h-[100dvh]">
      <header className="sticky top-0 z-20 border-b border-border/80 bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto max-w-[1280px] px-4 py-2 sm:px-6 sm:py-2.5 lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <Link to="/" className="flex min-h-11 min-w-0 items-center gap-2.5" aria-label="Ir para o início">
              <img src="/icons/favicon-32.png" alt="" className="size-7 shrink-0 rounded-lg ring-1 ring-primary/15 sm:size-8 sm:rounded-xl" aria-hidden />
              <span className="min-w-0">
                <span className="num block truncate text-sm font-semibold tracking-tight text-primary">
                  <span className="sm:hidden">BET VALUE</span>
                  <span className="hidden sm:inline">BET VALUE ENGINE</span>
                </span>
                <span className="hidden text-[10px] uppercase tracking-[0.14em] text-muted-foreground sm:block">
                  Motor de decisão esportiva
                </span>
              </span>
              <span className="num hidden rounded-md border border-border bg-secondary/35 px-1.5 py-0.5 text-[10px] text-muted-foreground md:inline">
                v2.1.1
              </span>
            </Link>

            <nav className="hidden items-center rounded-xl border border-border bg-secondary/25 p-1 sm:flex" aria-label="Acompanhamento">
              <Link
                to="/open-bets"
                aria-current={stage === "open-bets" ? "page" : undefined}
                className={desktopNavClass(stage === "open-bets")}
              >
                Em andamento
              </Link>
              <Link
                to="/analytics"
                aria-current={stage === "analytics" ? "page" : undefined}
                className={desktopNavClass(stage === "analytics")}
              >
                Desempenho
              </Link>
            </nav>

            <div className="flex items-center gap-1">
              <a
                href="/conta"
                className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl px-2 text-xs transition-colors active:bg-secondary sm:min-w-0 sm:px-3 sm:hover:bg-secondary ${stage === "account" ? "text-primary" : "text-muted-foreground sm:hover:text-foreground"}`}
                aria-label="Conta e privacidade"
                aria-current={stage === "account" ? "page" : undefined}
              >
                <ShieldCheck className="size-4" aria-hidden />
                <span className="hidden sm:inline">Conta</span>
              </a>
              <button
                type="button"
                onClick={() => void signOut()}
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl px-2 text-xs text-muted-foreground transition-colors active:bg-secondary sm:min-w-0 sm:px-3 sm:hover:bg-secondary sm:hover:text-foreground"
                aria-label="Sair da conta"
              >
                <LogOut className="size-4" aria-hidden />
                <span className="hidden sm:inline">Sair</span>
              </button>
            </div>
          </div>

          {showAnalysisProgress && (
            <>
              <div className="mt-2 hidden grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:grid">
                <ol className="grid grid-cols-4 gap-1 rounded-xl border border-border bg-secondary/20 p-1" aria-label="Progresso da análise">
                  {STAGES.map((item, index) => {
                    const isActive = item.key === stage;
                    return (
                      <li
                        key={item.key}
                        aria-current={isActive ? "step" : undefined}
                        className={`flex min-h-10 min-w-0 items-center justify-center rounded-lg px-2 text-center text-xs transition-colors ${
                          isActive
                            ? "bg-primary/15 font-medium text-primary ring-1 ring-primary/20"
                            : "text-muted-foreground"
                        }`}
                      >
                        <span className="mr-1.5 num text-[0.7rem] opacity-65">{index + 1}</span>
                        <span className="truncate">{item.label}</span>
                      </li>
                    );
                  })}
                </ol>

                <div className="flex min-h-10 items-center gap-2 rounded-xl border border-primary/15 bg-primary/[0.06] px-3 text-[11px] text-muted-foreground">
                  <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  <span className="whitespace-nowrap">
                    <span className="font-medium text-foreground">Regra ativa</span>
                    <span className="mx-1.5 text-border">·</span>
                    chance do modelo <strong className="font-semibold text-primary">&gt; 70%</strong>
                    <span className="mx-1.5">·</span>
                    odd real
                    <span className="mx-1.5">·</span>
                    EV mínimo de 2%
                  </span>
                </div>
              </div>

              <ol className="mt-1 grid grid-cols-4 gap-1 sm:hidden" aria-label="Progresso da análise">
                {STAGES.map((item, index) => {
                  const isActive = item.key === stage;
                  return (
                    <li
                      key={item.key}
                      aria-current={isActive ? "step" : undefined}
                      className={`flex min-h-8 min-w-0 items-center justify-center rounded-lg px-1 text-center text-[11px] transition-colors ${
                        isActive
                          ? "bg-primary/15 font-medium text-primary ring-1 ring-primary/20"
                          : "text-muted-foreground"
                      }`}
                    >
                      <span className="mr-1 num text-[0.65rem] opacity-65">{index + 1}</span>
                      <span className="truncate">{item.shortLabel}</span>
                    </li>
                  );
                })}
              </ol>

              <div className="mt-1 flex justify-center sm:hidden">
                <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-secondary/35 px-2.5 py-1 text-[10px] leading-4 text-muted-foreground">
                  <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  <span className="truncate">Regra: chance do modelo <strong className="font-medium text-foreground">&gt; 70%</strong> · odd real · EV mínimo de 2%</span>
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        {children}
        {stage === "resultado" && resultRunId && <BetConfirmationFlow runId={resultRunId} />}
      </main>

      <footer className="mx-auto hidden max-w-[1400px] px-4 pb-8 sm:block sm:px-6 lg:px-8">
        <details className="text-xs text-muted-foreground">
          <summary className="flex min-h-11 cursor-pointer list-none items-center py-2">Bet365 Brasil · Horário de Brasília · Apostas simples</summary>
          <p className="max-w-2xl pb-2">O sistema organiza a análise e o histórico; não faz apostas por você. <a href="/privacidade" className="underline underline-offset-4">Privacidade</a></p>
        </details>
      </footer>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border/80 bg-background/96 px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:hidden"
        aria-label="Navegação principal"
      >
        <div className="mx-auto grid max-w-lg grid-cols-3 gap-1">
          <Link to="/" aria-current={showAnalysisProgress ? "page" : undefined} className={mobileNavClass(showAnalysisProgress)}>
            <Search className="size-[18px]" strokeWidth={1.8} aria-hidden />
            Analisar
          </Link>
          <Link to="/open-bets" aria-current={stage === "open-bets" ? "page" : undefined} className={mobileNavClass(stage === "open-bets")}>
            <Clock3 className="size-[18px]" strokeWidth={1.8} aria-hidden />
            Em andamento
          </Link>
          <Link to="/analytics" aria-current={stage === "analytics" ? "page" : undefined} className={mobileNavClass(stage === "analytics")}>
            <BarChart3 className="size-[18px]" strokeWidth={1.8} aria-hidden />
            Desempenho
          </Link>
        </div>
      </nav>
    </div>
  );
}
