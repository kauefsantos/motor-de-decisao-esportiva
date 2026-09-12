import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("frontend/backend flow synchronization", () => {
  it("starts with an idempotent draft instead of directly creating and enqueueing a run", () => {
    const upload = source("./routes/index.tsx");
    expect(upload).toContain("createAnalysisDraft");
    expect(upload).toContain("clientRequestId");
    expect(upload).toContain('/draft/$draftId/validacao');
    expect(upload).not.toContain("createRun");
    expect(upload).not.toContain("enqueueAnalysis");
  });

  it("exposes backend-controlled validation and correction before finalization", () => {
    const validation = source("./routes/draft.$draftId.validacao.tsx");
    expect(validation).toContain("validateAnalysisDraft");
    expect(validation).toContain("correctAnalysisDraft");
    expect(validation).toContain("editable_fields");
    expect(validation).toContain("finalizeAnalysisDraft");
  });

  it("uses the persistent decision queue instead of the legacy experimental result flow", () => {
    const opportunities = source("./routes/run.$runId.oportunidades.tsx");
    const gate = source("./components/DecisionQueueGate.tsx");
    const queue = source("./components/DecisionQueueFlow.tsx");
    expect(opportunities).toContain("DecisionQueueGate");
    expect(opportunities).not.toContain("ExperimentalMarketsPilot");
    expect(gate).toContain("getDecisionQueueHistory");
    expect(gate).toContain("hasPersistedDecisionState");
    expect(gate).toContain("Modelos, integrações externas e cotações não foram executados novamente");
    expect(queue).toContain("buildDecisionOpportunityQueue");
    expect(queue).toContain("getDecisionQueueHistory");
    expect(queue).toContain("dailySelectionLimit");
    expect(queue).toContain("?? 3");
    expect(queue).not.toContain("localStorage");
    expect(queue).not.toContain("selectionLimitForDate");
  });

  it("does not hard-code UTC-3 in staged draft validation", () => {
    const draftFunctions = source("./lib/analysis-draft.functions.ts");
    expect(draftFunctions).toContain("saoPauloLocalDateTimeToIso");
    expect(draftFunctions).not.toContain(":00-03:00");
  });
});
