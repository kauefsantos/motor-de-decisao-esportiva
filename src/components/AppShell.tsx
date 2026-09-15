import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { BarChart3, Clock3, LogOut, Search, ShieldCheck } from "lucide-react";

import { ModelLabNotifications } from "@/components/ModelLabNotifications";
import { supabase } from "@/integrations/supabase/client";

const STAGES = [
  { key: "upload", label: "Enviar jogos" },
  { key: "processamento", label: "Analisar" },
  { key: "oportunidades", label: "Escolher" },
  { key: "resultado", label: "Registrar" },
] as const;

type StageKey = (typeof STAGES)[number]["key"] | "open-bets" | "analytics" | "account";

export function AppShell({ stage, children }: { stage: StageKey; children: ReactNode }) {
  const showAnalysisProgress = STAGES.some((item) => item.key === stage);
  const activeStageIndex = STAGES.findIndex((item) => item.key === stage);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      const coveredHeight = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardOpen(coveredHeight > 120);
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.assign("/");
  }

  const mobileNavClass = (active: boolean) =>
    `touch-target flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[11px] font-medium transition-colors ${
      active ? "bg-primary/12 text-primary" : "text-muted-foreground active:bg-secondary/70"
    }`;

  const desktopNavClass = (active: boolean) =>
    `touch-target flex min-h-9 items-center justify-center rounded-lg px-3.5 text-xs font-medium transition-colors ${
      active
        ? "bg-background text-foreground shadow-sm ring-1 ring-border"
        : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
    }`;

  return (
    <div className="min-h-[100dvh]" data-keyboard-open={keyboardOpen ? "true" : "false"}>
      <a href="#conteudo-principal" className="skip-link">Pular para o conteúdo principal</a>
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto max-w-[1280px] px-4 py-2 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <Link to="/" className="touch-target flex min-h-11 min-w-0 items-center gap-2.5" aria-label="Ir para o início">
              <img src="/icons/favicon-32.png" alt="" className="size-7 shrink-0 rounded-lg ring-1 ring-primary/15 sm:size-8 sm:rounded-xl" aria-hidden />
              <span className="min-w-0">
                <span className="num block truncate text-sm font-semibold tracking-tight text-primary">BET VALUE</span>
                <span className="hidden text-[10px] text-muted-foreground sm:block">Análise de jogos e oportunidades</span>
              </span>
            </Link>

            <nav className="hidden items-center rounded-xl bg-secondary/25 p-1 sm:flex" aria-label="Acompanhamento">
              <Link to="/open-bets" aria-current={stage === "open-bets" ? "page" : undefined} className={desktopNavClass(stage === "open-bets")}>Em andamento</Link>
              <Link to="/analytics" aria-current={stage === "analytics" ? "page" : undefined} className={desktopNavClass(stage === "analytics")}>Desempenho</Link>
            </nav>

            <div className="flex items-center gap-1">
              <a href="/conta" className={`touch-target flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl px-2 text-xs transition-colors active:bg-secondary sm:min-w-0 sm:px-3 sm:hover:bg-secondary ${stage === "account" ? "text-primary" : "text-muted-foreground sm:hover:text-foreground"}`} aria-label="Conta e privacidade" aria-current={stage === "account" ? "page" : undefined}>
                <ShieldCheck className="size-4" aria-hidden /><span className="hidden sm:inline">Conta</span>
              </a>
              <button type="button" onClick={() => void signOut()} className="touch-target flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl px-2 text-xs text-muted-foreground transition-colors active:bg-secondary sm:min-w-0 sm:px-3 sm:hover:bg-secondary sm:hover:text-foreground" aria-label="Sair da conta">
                <LogOut className="size-4" aria-hidden /><span className="hidden sm:inline">Sair</span>
              </button>
            </div>
          </div>

          {showAnalysisProgress && (
            <div className="mt-1.5 flex items-center gap-3" aria-label="Progresso da análise">
              <div className="flex min-w-0 flex-1 gap-1" aria-hidden>
                {STAGES.map((item, index) => (
                  <span
                    key={item.key}
                    className={`h-1.5 flex-1 rounded-full ${index <= activeStageIndex ? "bg-primary" : "bg-secondary"}`}
                  />
                ))}
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{activeStageIndex + 1} de {STAGES.length}</span>
                <span className="hidden sm:inline"> · {STAGES[activeStageIndex]?.label}</span>
              </span>
            </div>
          )}
        </div>
      </header>

      <main id="conteudo-principal" tabIndex={-1} className="mx-auto min-w-0 max-w-[1280px] px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:py-8 lg:px-8">
        {stage === "upload" && (
          <details className="mb-4 rounded-xl border border-border/60 bg-secondary/15 px-3 py-2 text-xs text-muted-foreground">
            <summary className="touch-target flex min-h-9 cursor-pointer list-none items-center font-medium text-foreground">Atualizações do laboratório</summary>
            <div className="pb-2"><ModelLabNotifications /></div>
          </details>
        )}
        {children}
      </main>

      <footer className="mx-auto hidden max-w-[1280px] px-4 pb-8 sm:block sm:px-6 lg:px-8">
        <details className="text-xs text-muted-foreground">
          <summary className="touch-target flex min-h-11 cursor-pointer list-none items-center py-2">Informações do sistema</summary>
          <p className="max-w-2xl pb-2">Bet365 Brasil · Horário de Brasília · apostas simples. O sistema organiza a análise e o histórico; não faz apostas por você. <a href="/privacidade" className="underline underline-offset-4">Privacidade</a></p>
        </details>
      </footer>

      <nav className={`${keyboardOpen ? "hidden" : "fixed"} inset-x-0 bottom-0 z-30 border-t border-border/80 bg-background/96 px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:hidden`} aria-label="Navegação principal" aria-hidden={keyboardOpen || undefined}>
        <div className="mx-auto grid max-w-lg grid-cols-3 gap-1">
          <Link to="/" aria-current={showAnalysisProgress ? "page" : undefined} className={mobileNavClass(showAnalysisProgress)}><Search className="size-[18px]" strokeWidth={1.8} aria-hidden />Analisar</Link>
          <Link to="/open-bets" aria-current={stage === "open-bets" ? "page" : undefined} className={mobileNavClass(stage === "open-bets")}><Clock3 className="size-[18px]" strokeWidth={1.8} aria-hidden />Em andamento</Link>
          <Link to="/analytics" aria-current={stage === "analytics" ? "page" : undefined} className={mobileNavClass(stage === "analytics")}><BarChart3 className="size-[18px]" strokeWidth={1.8} aria-hidden />Desempenho</Link>
        </div>
      </nav>
    </div>
  );
}
