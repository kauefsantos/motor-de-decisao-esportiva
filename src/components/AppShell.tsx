import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";

import { BetConfirmationFlow } from "@/components/BetConfirmationFlow";

const STAGES = [
  { key: "upload", label: "1 · Enviar jogos" },
  { key: "processamento", label: "2 · Preparar análise" },
  { key: "oportunidades", label: "3 · Conferir mercados" },
  { key: "resultado", label: "4 · Ver seleções" },
] as const;

type StageKey = (typeof STAGES)[number]["key"] | "open-bets" | "analytics";

export function AppShell({
  stage,
  children,
}: {
  stage: StageKey;
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const resultMatch = pathname.match(/^\/run\/([0-9a-f-]+)\/resultado$/i);
  const resultRunId = resultMatch?.[1] ?? null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-8 py-4">
          <Link to="/" className="flex items-baseline gap-3">
            <span className="num text-sm font-semibold tracking-tight text-primary">
              BET VALUE ENGINE
            </span>
            <span className="num text-[11px] text-muted-foreground">V2.1.1</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-1">
            {STAGES.map((s, index) => {
              const isActive = s.key === stage;
              const baseClasses =
                "rounded-md px-3 py-1.5 text-[11px] tracking-wide transition-colors";
              const activeClasses = "bg-primary/15 text-primary";
              const inactiveClasses = "text-muted-foreground hover:bg-secondary hover:text-foreground";

              if (index === 0) {
                return (
                  <Link
                    key={s.key}
                    to="/"
                    className={`${baseClasses} ${isActive ? activeClasses : inactiveClasses}`}
                  >
                    {s.label}
                  </Link>
                );
              }

              return (
                <span
                  key={s.key}
                  className={`${baseClasses} ${isActive ? activeClasses : inactiveClasses}`}
                >
                  {s.label}
                </span>
              );
            })}
            <Link
              to="/open-bets"
              className={`ml-1 rounded-md px-3 py-1.5 text-[11px] tracking-wide transition-colors ${
                stage === "open-bets"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              Apostas abertas
            </Link>
            <Link
              to="/analytics"
              className={`rounded-md px-3 py-1.5 text-[11px] tracking-wide transition-colors ${
                stage === "analytics"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              Desempenho
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-8 py-10">
        {children}
        {stage === "resultado" && resultRunId && <BetConfirmationFlow runId={resultRunId} />}
      </main>
      <footer className="mx-auto max-w-[1400px] px-8 pb-10">
        <p className="text-xs text-muted-foreground">
          Bet365 Brasil · Horários de Brasília · Apenas apostas simples. O sistema organiza a análise e o histórico; não faz apostas por você.
        </p>
      </footer>
    </div>
  );
}
