import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";

import { BetConfirmationFlow } from "@/components/BetConfirmationFlow";

const STAGES = [
  { key: "upload", label: "1 · Enviar jogos" },
  { key: "processamento", label: "2 · Preparar" },
  { key: "oportunidades", label: "3 · Ver opções" },
  { key: "resultado", label: "4 · Ver sugestões" },
] as const;

type StageKey = (typeof STAGES)[number]["key"] | "open-bets" | "analytics";

export function AppShell({ stage, children }: { stage: StageKey; children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const resultMatch = pathname.match(/^\/run\/([0-9a-f-]+)\/resultado$/i);
  const resultRunId = resultMatch?.[1] ?? null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto max-w-[1400px] px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <Link to="/" className="flex min-h-11 shrink-0 items-center gap-2">
              <span className="num text-sm font-semibold tracking-tight text-primary">BET VALUE ENGINE</span>
              <span className="num hidden text-[10px] text-muted-foreground sm:inline">V2.1.1</span>
            </Link>
          </div>

          <nav className="-mx-1 mt-2 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mt-0 sm:justify-end">
            {STAGES.map((s, index) => {
              const isActive = s.key === stage;
              const base = "flex min-h-10 shrink-0 items-center rounded-lg px-3 text-[11px] tracking-wide transition-colors";
              const active = "bg-primary/15 text-primary ring-1 ring-primary/20";
              const inactive = "text-muted-foreground hover:bg-secondary hover:text-foreground";
              if (index === 0) {
                return (
                  <Link key={s.key} to="/" className={`${base} ${isActive ? active : inactive}`}>
                    {s.label}
                  </Link>
                );
              }
              return (
                <span key={s.key} className={`${base} ${isActive ? active : inactive}`}>
                  {s.label}
                </span>
              );
            })}
            <Link
              to="/open-bets"
              className={`flex min-h-10 shrink-0 items-center rounded-lg px-3 text-[11px] tracking-wide transition-colors ${
                stage === "open-bets" ? "bg-primary/15 text-primary ring-1 ring-primary/20" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              Em andamento
            </Link>
            <Link
              to="/analytics"
              className={`flex min-h-10 shrink-0 items-center rounded-lg px-3 text-[11px] tracking-wide transition-colors ${
                stage === "analytics" ? "bg-primary/15 text-primary ring-1 ring-primary/20" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              Desempenho
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        {children}
        {stage === "resultado" && resultRunId && <BetConfirmationFlow runId={resultRunId} />}
      </main>

      <footer className="mx-auto max-w-[1400px] px-4 pb-8 sm:px-6 lg:px-8">
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer list-none py-2">Bet365 Brasil · Horário de Brasília · Apostas simples</summary>
          <p className="max-w-2xl pb-2">O sistema organiza a análise e o histórico; não faz apostas por você.</p>
        </details>
      </footer>
    </div>
  );
}
