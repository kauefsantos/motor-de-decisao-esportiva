import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("zero-opportunity finalized-state regression", () => {
  it("shows the legitimate zero-opportunity result before the generic finalized state", () => {
    const gate = source("./components/DecisionQueueGate.tsx");
    const zeroResultIndex = gate.indexOf("if (zeroOpportunityResult)");
    const finalizedIndex = gate.indexOf("if (history.selectionFinalized)");

    expect(gate).toContain("const zeroOpportunityResult = history.decisionQueueEvaluated && rows.length === 0");
    expect(gate).toContain("Nenhuma oportunidade nesta rodada");
    expect(zeroResultIndex).toBeGreaterThan(-1);
    expect(finalizedIndex).toBeGreaterThan(zeroResultIndex);
  });

  it("keeps finalized selections recoverable when there are persisted queue rows", () => {
    const gate = source("./components/DecisionQueueGate.tsx");
    expect(gate).toContain("Escolhas salvas");
    expect(gate).toContain("Revisar escolhas");
    expect(gate).toContain("history.selectionFinalized");
  });
});
