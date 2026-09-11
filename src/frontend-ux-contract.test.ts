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

  it("stops processing UI work after route exit", () => {
    const processing = source("./routes/run.$runId.processamento.tsx");
    expect(processing).toContain("let cancelled = false");
    expect(processing).toContain("if (cancelled) return");
    expect(processing).toContain("cancelled = true");
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
