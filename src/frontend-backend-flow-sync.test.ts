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

  it("never re-enqueues analysis runs that are already terminal", () => {
    const background = source("./lib/background-analysis.functions.ts");
    expect(background).toContain('const NON_ENQUEUEABLE_RUN_STATUSES = new Set(["READY_FOR_ODDS", "COMPLETED"])');
    expect(background).toContain('NON_ENQUEUEABLE_RUN_STATUSES.has(String(run.status ?? ""))');
    expect(background).toContain('ready: NON_ENQUEUEABLE_RUN_STATUSES.has(String(run.status ?? ""))');
  });

  it("uses the persistent decision queue instead of the legacy experimental result flow", () => {
    const opportunities = source("./routes/run.$runId.oportunidades.tsx");
    const gate = source("./components/DecisionQueueGate.tsx");
    const queue = source("./components/DecisionQueueFlow.tsx");
    const queueFunctions = source("./lib/decision-queue.functions.ts");
    expect(opportunities).toContain("DecisionQueueGate");
    expect(opportunities).not.toContain("ExperimentalMarketsPilot");
    expect(gate).toContain("getDecisionQueueHistory");
    expect(gate).toContain("hasPersistedDecisionState");
    expect(gate).toContain("decisionQueueEvaluated");
    expect(gate).toContain("Nenhuma opção passou por todos os critérios");
    expect(gate).toContain("Atualizar ou reabrir a página não repete os modelos nem as cotações desta avaliação");
    expect(gate).toContain("Suas decisões foram recuperadas sem repetir a análise ou as cotações");
    expect(queueFunctions).toContain("DECISION_QUEUE_EVALUATED");
    expect(queueFunctions).toContain("decisionQueueEvaluated");
    expect(queue).toContain("buildDecisionOpportunityQueue");
    expect(queue).toContain("getDecisionQueueHistory");
    expect(queue).toContain("dailySelectionLimit");
    expect(queue).toContain("?? 3");
    expect(queue).not.toContain("localStorage");
    expect(queue).not.toContain("selectionLimitForDate");
  });

  it("uses America/Sao_Paulo semantics for validation and the Bet365 daily window", () => {
    const draftFunctions = source("./lib/analysis-draft.functions.ts");
    const bet365 = source("./lib/bet365-odds.server.ts");
    expect(draftFunctions).toContain("saoPauloLocalDateTimeToIso");
    expect(draftFunctions).not.toContain(":00-03:00");
    expect(bet365).toContain("saoPauloLocalDayUnixWindow");
    expect(bet365).not.toContain("T03:00:00Z");
    expect(bet365).not.toContain("start + 24 * 3600");
  });
});
