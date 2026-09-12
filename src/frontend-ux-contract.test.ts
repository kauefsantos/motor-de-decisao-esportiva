import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("frontend P0/P1 UX contract", () => {
  it("uses a single odds-review flow", () => {
    const route = source("./routes/run.$runId.oportunidades.tsx");
    expect(route.match(/<ExperimentalMarketsPilot/g)?.length).toBe(1);
    expect(route).not.toContain("analyzeOdds");
    expect(route).not.toContain("COMPARAR ODDS");
    expect(route).toContain("Conferir odds");
  });

  it("shows automatic odds and describes the real analysis scope", () => {
    const pilot = source("./components/ExperimentalMarketsPilot.tsx");
    expect(pilot).toContain("Odds encontradas automaticamente");
    expect(pilot).toContain("ANALISAR ODDS DISPONÍVEIS");
    expect(pilot).toContain("odds automáticas e todas as odds manuais válidas");
    expect(pilot).not.toContain("COMPARAR ODDS DESTE LOTE");
  });

  it("never presents a query failure as an empty model result", () => {
    const pilot = source("./components/ExperimentalMarketsPilot.tsx");
    const result = source("./routes/run.$runId.resultado.tsx");
    expect(pilot).toContain("Não foi possível preparar as opções");
    expect(pilot).toContain("Isso não significa que não existam oportunidades");
    expect(result).toContain("A falha de carregamento não significa que nenhuma odd tenha compensado");
    expect(result).toContain("!isLoading && !isError && selected.length === 0");
    expect(result).toContain("não tratamos essa situação como “nenhuma odd compensou”");
  });

  it("keeps processing independent from the route lifecycle", () => {
    const processing = source("./routes/run.$runId.processamento.tsx");
    expect(processing).toContain("getProcessingStatus");
    expect(processing).toContain("enqueueAnalysis");
    expect(processing).not.toContain("runStep");
    expect(processing).not.toContain("let cancelled = false");
  });

  it("makes bet registration language explicit", () => {
    const confirmation = source("./components/BetConfirmationFlow.tsx");
    expect(confirmation).toContain("Registrar aposta");
    expect(confirmation).toContain("O painel não executa a aposta por você");
    expect(confirmation).not.toContain("Apostar {money(suggested)}");
  });

  it("requires confirmation and blocks duplicate settlement actions", () => {
    const openBets = source("./routes/open-bets.tsx");
    expect(openBets).toContain("settlingId");
    expect(openBets).toContain("Confirmar resultado");
    expect(openBets).toContain("disabled={settlingId !== null}");
  });
});

describe("frontend P2 usability and performance contract", () => {
  it("separates analysis progress from persistent navigation", () => {
    const shell = source("./components/AppShell.tsx");
    expect(shell).toContain('aria-label="Progresso da análise"');
    expect(shell).toContain('aria-label="Acompanhamento"');
    expect(shell).toContain("grid grid-cols-4");
    expect(shell).toContain("Em andamento");
    expect(shell).toContain("Desempenho");
    expect(shell).not.toContain("overflow-x-auto");
  });

  it("lazy-renders collapsible content and exposes it as a region", () => {
    const panel = source("./components/CollapsiblePanel.tsx");
    expect(panel).toContain("{open && (");
    expect(panel).toContain('role="region"');
    expect(panel).toContain("aria-labelledby={buttonId}");
    expect(panel).not.toContain("grid-rows-[0fr]");
  });

  it("keeps touch targets and mobile microcopy legible", () => {
    const input = source("./components/ui/input.tsx");
    const styles = source("./styles.css");
    expect(input).toContain("h-11");
    expect(styles).toContain(".text-\\[10px\\]");
    expect(styles).toContain("font-size: 0.75rem");
  });

  it("avoids expensive blur on every panel and respects reduced motion", () => {
    const styles = source("./styles.css");
    expect(styles).not.toContain("backdrop-filter: blur(10px)");
    expect(styles).toContain("prefers-reduced-motion: reduce");
  });

  it("uses a single place to settle bets and keeps analytics read-only", () => {
    const openBets = source("./routes/open-bets.tsx");
    const analytics = source("./routes/analytics.tsx");
    expect(openBets).toContain("única tela que encerra apostas e atualiza a banca");
    expect(analytics).toContain("somente para acompanhar banca, resultados e qualidade das estimativas");
    expect(analytics).toContain("histórico abaixo é somente leitura");
    expect(analytics).not.toContain("updateExperimentalTracking");
    expect(analytics).not.toContain("<Input");
  });

  it("keeps card labels human-readable and makes the bankroll chart informative", () => {
    const analytics = source("./routes/analytics.tsx");
    expect(analytics).toContain('CARDS: "Cartões"');
    expect(analytics).toContain("Menor saldo");
    expect(analytics).toContain("Maior saldo");
    expect(analytics).toContain("A linha tracejada marca o saldo inicial");
  });
});

describe("frontend P3 final polish contract", () => {
  it("returns the user to the route they requested after Google login", () => {
    const auth = source("./components/AuthGate.tsx");
    expect(auth).toContain("window.location.pathname");
    expect(auth).toContain("window.location.search");
    expect(auth).toContain("redirect_uri: currentReturnUrl()");
    expect(auth).not.toContain('redirect_uri: `${window.location.origin}/`');
  });

  it("hides analysis progress outside the analysis journey and exposes current pages", () => {
    const shell = source("./components/AppShell.tsx");
    expect(shell).toContain("showAnalysisProgress");
    expect(shell).toContain("{showAnalysisProgress && (");
    expect(shell).toContain('aria-current={stage === "open-bets" ? "page" : undefined}');
    expect(shell).toContain('aria-current={stage === "analytics" ? "page" : undefined}');
  });

  it("shows an explicit retry state when open bets fail to load", () => {
    const openBets = source("./routes/open-bets.tsx");
    expect(openBets).toContain("isError");
    expect(openBets).toContain("Não foi possível carregar as apostas em andamento");
    expect(openBets).toContain("Tentar novamente");
    expect(openBets).toContain("openBetCountLabel");
  });

  it("keeps source detail disclosures accessible and labels metrics clearly", () => {
    const audit = source("./components/SourceAudit.tsx");
    expect(audit).toContain("aria-controls={detailsId}");
    expect(audit).toContain('role="region"');
    expect(audit).toContain("Jogos encontrados");
    expect(audit).toContain("Dados aproveitados");
  });

  it("keeps fallback actions comfortably tappable", () => {
    const root = source("./routes/__root.tsx");
    expect(root).toContain("min-h-11");
    expect(root).toContain('role="alert"');
  });
});

describe("frontend iPhone mobile-first contract", () => {
  it("respects dynamic viewport and safe areas on the auth flow", () => {
    const auth = source("./components/AuthGate.tsx");
    expect(auth).toContain("min-h-[100dvh]");
    expect(auth).toContain("safe-area-inset-top");
    expect(auth).toContain("safe-area-inset-bottom");
  });

  it("uses a bottom navigation and leaves room for the Home Indicator", () => {
    const shell = source("./components/AppShell.tsx");
    expect(shell).toContain('aria-label="Navegação principal"');
    expect(shell).toContain("safe-area-inset-bottom");
    expect(shell).toContain("fixed inset-x-0 bottom-0");
  });

  it("keeps manual odds easy to enter on narrow phone layouts", () => {
    const pilot = source("./components/ExperimentalMarketsPilot.tsx");
    const styles = source("./styles.css");
    expect(pilot).toContain('className="num mt-1 w-28"');
    expect(styles).toContain("input.w-28");
    expect(styles).toContain("width: 100%");
  });

  it("keeps the session for 30 days with the server as the authority", () => {
    const auth = source("./components/AuthGate.tsx");
    const sessionPolicy = source("./integrations/supabase/session-policy.ts");
    const authMiddleware = source("./integrations/supabase/auth-middleware.ts");

    expect(sessionPolicy).toContain("SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60");
    expect(auth).toContain("isAuthenticationFresh(claims)");
    expect(auth).toContain("supabase.auth.signOut()");
    expect(auth).toContain("Sua sessão de 30 dias terminou");
    expect(auth).not.toContain("bet-value-mobile-auth-at");
    expect(authMiddleware).toContain("isAuthenticationFresh(claims)");
  });

  it("uses branded icons for the installed app and in-app identity", () => {
    const root = source("./routes/__root.tsx");
    const shell = source("./components/AppShell.tsx");
    const manifest = source("../public/site.webmanifest");
    expect(root).toContain("/icons/apple-touch-icon.png");
    expect(root).toContain("/icons/favicon-32.png");
    expect(shell).toContain("/icons/favicon-32.png");
    expect(manifest).toContain("/icons/icon-192.png");
    expect(manifest).toContain("/icons/icon-512.png");
  });

  it("repairs legacy mojibake in visible competition labels", () => {
    const openBets = source("./routes/open-bets.tsx");
    const csv = source("./lib/csv.ts");
    expect(openBets).toContain("repairMojibake(row.competition)");
    expect(csv).toContain("repairMojibake(");
  });
});
