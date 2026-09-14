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
    expect(flow).toContain("Odds que precisam de conferência manual");
    expect(flow).toContain("Odd Bet365 manual");
    expect(flow).toContain("A API não fornece este contrato automaticamente");
  });

  it("requires the exact modeled contract and preserves the same value gates", () => {
    const flow = source("./components/DecisionQueueFlow.tsx");
    const confirmation = source("./lib/engine/quote-confirmation.ts");
    const queue = source("./lib/decision-queue.functions.ts");
    const policy = source("./lib/engine/market-policy.ts");

    expect(flow).toContain("mesmo mercado, lado e linha");
    expect(flow).toContain("Não use essa cotação; informe manualmente somente a odd da linha exata mostrada aqui.");
    expect(flow).toContain("chance ≥70%, odd ≥1,70, EV ≥8% e vantagem ≥5 p.p.");
    expect(confirmation).toContain("lineAtEntry: candidate.lineCanonical");
    expect(confirmation).toContain('quote?.status === "MATCHED"');
    expect(queue).toContain("evaluateValue({");
    expect(queue).toContain('bookmaker: "bet365_br"');
    expect(policy).toContain("export const MODEL_LEAN_THRESHOLD = 0.70");
  });
});
