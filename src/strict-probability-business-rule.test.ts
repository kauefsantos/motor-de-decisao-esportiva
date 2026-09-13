import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("market qualification business rule", () => {
  it("uses inclusive 70%, odd >=1.70, EV >=8% and edge >=5pp in the value engine", () => {
    const decisionRules = source("./lib/engine/decision-rules.ts");
    const value = source("./lib/engine/value.ts");

    expect(decisionRules).toContain("MIN_MODEL_PROBABILITY = 0.70");
    expect(decisionRules).toContain("MIN_ENTRY_ODD = 1.70");
    expect(decisionRules).toContain("EV_TARGET = 0.08");
    expect(decisionRules).toContain("MIN_EDGE = 0.05");
    expect(value).toContain('from "./decision-rules"');
    expect(value).toContain("probability >= MIN_MODEL_PROBABILITY");
    expect(value).toContain("odd >= MIN_ENTRY_ODD");
    expect(value).toContain('"ODD_BELOW_MINIMUM"');
  });

  it("does not request Bet365 prices for experimental rows below the confidence gate", () => {
    const automaticOdds = source("./lib/auto-bet365-odds.functions.ts");
    expect(automaticOdds).toContain("passesExperimentalModelGate(Number(row.model_probability))");
  });

  it("rechecks every quantitative gate at portfolio selection", () => {
    const portfolio = source("./lib/engine/portfolio-selection.ts");
    expect(portfolio).toContain("passesModelProbabilityGate(row.decisionProbability)");
    expect(portfolio).toContain("passesMinimumOddGate(row.odd)");
    expect(portfolio).toContain("row.evCons");
    expect(portfolio).toContain("row.edgeCons");
    expect(portfolio).toContain("MAX_SELECTIONS");
  });

  it("keeps the active rule visible in the technical diagnostic without cluttering the global shell", () => {
    const shell = source("./components/AppShell.tsx");
    const diagnostic = source("./routes/diagnostico.tsx");
    expect(diagnostic).toContain("Regra 70% + odd 1,70 + value");
    expect(diagnostic).toContain("EV ≥ 8%");
    expect(shell).not.toContain("EV mínimo de 8%");
  });
});
