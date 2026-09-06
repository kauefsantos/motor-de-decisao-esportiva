import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

const STAGES = [
  { key: "upload", label: "1 · Upload" },
  { key: "processamento", label: "2 · Processamento" },
  { key: "oportunidades", label: "3 · Oportunidades" },
  { key: "resultado", label: "4 · Resultado final" },
] as const;

export function AppShell({
  stage,
  children,
}: {
  stage: (typeof STAGES)[number]["key"];
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6 px-8 py-4">
          <Link to="/" className="flex items-baseline gap-3">
            <span className="num text-sm font-semibold tracking-tight text-primary">
              BET VALUE ENGINE
            </span>
            <span className="num text-[11px] text-muted-foreground">V2.1.1</span>
          </Link>
          <nav className="flex items-center gap-1">
            {STAGES.map((s) => (
              <span
                key={s.key}
                className={`num rounded-md px-3 py-1.5 text-[11px] tracking-wide ${
                  s.key === stage
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground"
                }`}
              >
                {s.label}
              </span>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-8 py-10">{children}</main>
      <footer className="mx-auto max-w-[1400px] px-8 pb-10">
        <p className="text-xs text-muted-foreground">
          Bookmaker operacional: bet365 Brasil · Fuso America/Sao_Paulo · Horizonte padrão 90min +
          acréscimos. Apenas apostas simples. Ferramenta analítica: não executa nem envia apostas.
        </p>
      </footer>
    </div>
  );
}
