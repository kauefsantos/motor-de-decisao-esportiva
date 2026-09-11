import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { LogOut } from "lucide-react";

import { BetConfirmationFlow } from "@/components/BetConfirmationFlow";
import { supabase } from "@/integrations/supabase/client";

const STAGES = [
  { key: "upload", label: "Enviar jogos", shortLabel: "Enviar" },
  { key: "processamento", label: "Preparar", shortLabel: "Preparar" },
  { key: "oportunidades", label: "Conferir odds", shortLabel: "Odds" },
  { key: "resultado", label: "Ver sugestões", shortLabel: "Sugestões" },
] as const;

type StageKey = (typeof STAGES)[number]["key"] | "open-bets" | "analytics";

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
    `flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-2 text-[11px] font-medium transition-colors ${
      active ? "bg-primary/14 text-primary" : "text-muted-foreground active:bg-secondary/70"
    }`;

  return (
    <div className="min-h-[100dvh]">
      <header className="sticky top-0 z-20 border-b border-border bg-background/94 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto max-w-[1400px] px-3 py-2.5 sm:px-6 sm:py-3 lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <Link to="/" className="flex min-h-11 min-w-0 items-center gap-2" aria-label="Ir para o início">
              <img src="/icons/favicon-32.png" alt="" className="size-7 shrink-0 rounded-lg" aria-hidden />
              <span className="num truncate text-sm font-semibold tracking-tight text-primary">
                <span className="sm:hidden">BET VALUE</span>
                <span className="hidden sm:inline">BET VALUE ENGINE</span>
              </span>
              <span className="num hidden text-xs text-muted-foreground sm:inline">V2.1.1</span>
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-xs text-muted-foreground transition-colors active:bg-secondary sm:min-w-0 sm:rounded-lg sm:hover:bg-secondary sm:hover:text-foreground"
              aria-label="Sair da conta"
            >
              <LogOut className="size-4" aria-hidden />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>

          {showAnalysisProgress && (
            <>
              <ol className="mt-1.5 grid grid-cols-4 gap-1" aria-label="Progresso da análise">
                {STAGES.map((item, index) => {
                  const isActive = item.key === stage;
                  return (
                    <li
                      key={item.key}
                      aria-current={isActive ? "step" : undefined}
                      className={`flex min-h-9 min-w-0 items-center justify-center rounded-lg px-1.5 text-center text-[11px] transition-colors sm:min-h-10 sm:px-2 sm:text-xs ${
                        isActive
                          ? "bg-primary/15 font-medium text-primary ring-1 ring-primary/20"
                          : "text-muted-foreground"
                      }`}
                    >
                      <span className="mr-1 num text-[0.65rem] opacity-70 sm:text-[0.7rem]">{index + 1}</span>
                      <span className="truncate sm:hidden">{item.shortLabel}</span>
                      <span className="hidden truncate sm:inline">{item.label}</span>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-1.5 text-center text-[10px] leading-4 text-muted-foreground sm:text-right sm:text-[11px]">
                Regra atual: chance do modelo <strong className="font-medium text-foreground">&gt; 70%</strong> + odd real + EV mínimo de 2%.
              </p>
            </>
          )}

          <nav className="mt-2 hidden justify-end gap-2 sm:flex" aria-label="Acompanhamento">
            <Link
              to="/open-bets"
              aria-current={stage === "open-bets" ? "page" : undefined}
              className={`flex min-h-11 items-center justify-center rounded-lg px-4 text-xs font-medium transition-colors ${
                stage === "open-bets"
                  ? "bg-primary/15 text-primary ring-1 ring-primary/20"
                  : "bg-secondary/35 text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              Em andamento
            </Link>
            <Link
              to="/analytics"
              aria-current={stage === "analytics" ? "page" : undefined}
              className={`flex min-h-11 items-center justify-center rounded-lg px-4 text-xs font-medium transition-colors ${
                stage === "analytics"
                  ? "bg-primary/15 text-primary ring-1 ring-primary/20"
                  : "bg-secondary/35 text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              Desempenho
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-3 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        {children}
        {stage === "resultado" && resultRunId && <BetConfirmationFlow runId={resultRunId} />}
      </main>

      <footer className="mx-auto hidden max-w-[1400px] px-4 pb-8 sm:block sm:px-6 lg:px-8">
        <details className="text-xs text-muted-foreground">
          <summary className="flex min-h-11 cursor-pointer list-none items-center py-2">Bet365 Brasil · Horário de Brasília · Apostas simples</summary>
          <p className="max-w-2xl pb-2">O sistema organiza a análise e o histórico; não faz apostas por você.</p>
        </details>
      </footer>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/96 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:hidden"
        aria-label="Navegação principal"
      >
        <div className="mx-auto grid max-w-lg grid-cols-3 gap-1">
          <Link to="/" aria-current={showAnalysisProgress ? "page" : undefined} className={mobileNavClass(showAnalysisProgress)}>
            <span className={`h-1 w-5 rounded-full ${showAnalysisProgress ? "bg-primary" : "bg-transparent"}`} aria-hidden />
            Analisar
          </Link>
          <Link to="/open-bets" aria-current={stage === "open-bets" ? "page" : undefined} className={mobileNavClass(stage === "open-bets")}>
            <span className={`h-1 w-5 rounded-full ${stage === "open-bets" ? "bg-primary" : "bg-transparent"}`} aria-hidden />
            Em andamento
          </Link>
          <Link to="/analytics" aria-current={stage === "analytics" ? "page" : undefined} className={mobileNavClass(stage === "analytics")}>
            <span className={`h-1 w-5 rounded-full ${stage === "analytics" ? "bg-primary" : "bg-transparent"}`} aria-hidden />
            Desempenho
          </Link>
        </div>
      </nav>
    </div>
  );
}
