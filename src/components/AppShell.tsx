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

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-background/94 backdrop-blur-xl">
        <div className="mx-auto max-w-[1400px] px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <Link to="/" className="flex min-h-11 shrink-0 items-center gap-2" aria-label="Ir para o início">
              <span className="num text-sm font-semibold tracking-tight text-primary">BET VALUE ENGINE</span>
              <span className="num hidden text-xs text-muted-foreground sm:inline">V2.1.1</span>
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Sair da conta"
            >
              <LogOut className="size-4" aria-hidden />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>

          <div className={`mt-2 grid gap-2 ${showAnalysisProgress ? "sm:grid-cols-[1fr_auto] sm:items-center" : "sm:flex sm:justify-end"}`}>
            {showAnalysisProgress && (
              <ol className="grid grid-cols-4 gap-1" aria-label="Progresso da análise">
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
                      <span className="mr-1 num text-[0.7rem] opacity-70">{index + 1}</span>
                      <span className="truncate sm:hidden">{item.shortLabel}</span>
                      <span className="hidden truncate sm:inline">{item.label}</span>
                    </li>
                  );
                })}
              </ol>
            )}

            <nav className="grid grid-cols-2 gap-2 sm:flex" aria-label="Acompanhamento">
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
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        {children}
        {stage === "resultado" && resultRunId && <BetConfirmationFlow runId={resultRunId} />}
      </main>

      <footer className="mx-auto max-w-[1400px] px-4 pb-8 sm:px-6 lg:px-8">
        <details className="text-xs text-muted-foreground">
          <summary className="flex min-h-11 cursor-pointer list-none items-center py-2">Bet365 Brasil · Horário de Brasília · Apostas simples</summary>
          <p className="max-w-2xl pb-2">O sistema organiza a análise e o histórico; não faz apostas por você.</p>
        </details>
      </footer>
    </div>
  );
}
