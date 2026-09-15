import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("manual odds fallback contract", () => {
  it("keeps unsupported API contracts available for explicit Bet365 manual entry", () => {
    const flow = source("./components/DecisionQueueFlow.tsx");
    const autoOdds = source("./lib/auto-bet365-odds.service.server.ts");

    expect(autoOdds).toContain('status: "UNSUPPORTED"');
    expect(autoOdds).toContain("buildManualQuoteBatches");
    expect(flow).toContain("Confira as odds que faltam");
    expect(flow).toContain("Odd Bet365");
    expect(flow).toContain("Esta opção precisa ser conferida diretamente na Bet365");
  });

  it("requires the exact modeled contract and preserves the same value gates", () => {
    const flow = source("./components/DecisionQueueFlow.tsx");
    const confirmation = source("./lib/engine/quote-confirmation.ts");
    const queue = source("./lib/decision-queue.functions.ts");
    const policy = source("./lib/engine/market-policy.ts");

    expect(flow).toContain("Digite apenas a odd da linha exata mostrada aqui");
    expect(flow).toContain("candidate.marketLabel");
    expect(flow).toContain("candidate.lineCanonical");
    expect(flow).toContain("filtros de probabilidade, odd, valor esperado, vantagem, correlação e limite de escolhas");
    expect(confirmation).toContain("lineAtEntry: candidate.lineCanonical");
    expect(confirmation).toContain('quote?.status === "MATCHED"');
    expect(queue).toContain("evaluateValue({");
    expect(queue).toContain('bookmaker: "bet365_br"');
    expect(policy).toContain("export const MODEL_LEAN_THRESHOLD = 0.70");
  });
});
