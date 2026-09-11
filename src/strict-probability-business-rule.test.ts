import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("strict >70% business rule", () => {
  it("blocks probability before value and uses an explicit rejection reason", () => {
    const value = source("./lib/engine/value.ts");
    expect(value).toContain("MIN_MODEL_PROBABILITY = 0.70");
    expect(value).toContain("probability > MIN_MODEL_PROBABILITY");
    expect(value).toContain('"MODEL_PROBABILITY_BELOW_THRESHOLD"');
  });

  it("does not request Bet365 prices for experimental rows that fail the confidence gate", () => {
    const automaticOdds = source("./lib/auto-bet365-odds.functions.ts");
    expect(automaticOdds).toContain("passesExperimentalModelGate(Number(row.model_probability))");
    expect(automaticOdds).toContain("Somente opções com chance do modelo >70% seguem para cotação");
  });

  it("rechecks the gate at portfolio selection", () => {
    const portfolio = source("./lib/engine/portfolio-selection.ts");
    expect(portfolio).toContain("passesModelProbabilityGate(row.decisionProbability)");
  });

  it("communicates the active rule in the analysis frontend", () => {
    const shell = source("./components/AppShell.tsx");
    expect(shell).toContain("chance do modelo");
    expect(shell).toContain("&gt; 70%");
    expect(shell).toContain("EV mínimo de 2%");
  });
});
