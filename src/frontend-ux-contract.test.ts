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
