import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("decision funnel observability", () => {
  it("keeps observability read-only and derives the inclusive probability gate from the canonical helper", () => {
    const fn = source("./lib/decision-observability.functions.ts");
    expect(fn).toContain("passesExperimentalModelGate");
    expect(fn).toContain("filterQuoteAnchorPredictions");
    expect(fn).toContain("pricedAtOrBelow70");
    expect(fn).toContain("automaticEvPass");
    expect(fn).not.toContain(".insert(");
    expect(fn).not.toContain(".update(");
    expect(fn).not.toContain(".delete(");
    expect(fn).not.toContain(".upsert(");
  });

  it("does not use a pre-rule run as proof that the active market funnel works in production", () => {
    const fn = source("./lib/decision-observability.functions.ts");
    expect(fn).toContain("STRICT_GATE_EFFECTIVE_AT");
    expect(fn).toContain("strictRuleHasRealRun");
    expect(fn).toContain("Ainda não existe uma análise iniciada depois da ativação da nova régua; os números exibidos são apenas referência histórica.");
  });

  it("exposes the mobile-first diagnostic screen with the whole decision funnel", () => {
    const route = source("./routes/diagnostico.tsx");
    expect(route).toContain("Funil de decisão");
    expect(route).toContain("Chance ≥ 70%");
    expect(route).toContain("Chance < 70%");
    expect(route).toContain("EV ≥ 8% + edge ≥ 5 p.p.");
    expect(route).toContain("Cotação indevida abaixo de 70%");
    expect(route).toContain("Sugestões finais");
  });

  it("makes the diagnostic reachable from the existing source audit", () => {
    const audit = source("./components/SourceAudit.tsx");
    expect(audit).toContain('to="/diagnostico"');
    expect(audit).toContain("Abrir diagnóstico completo");
  });
});
