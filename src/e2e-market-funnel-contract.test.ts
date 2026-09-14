import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("production E2E market funnel contract", () => {
  it("collects the whole round through resumable, idempotent match batches", () => {
    const collect = source("./lib/pipeline/collect.server.ts");
    const worker = source("./routes/api.analysis-worker.ts");

    expect(collect).toContain("COLLECT_BATCH_SIZE = 4");
    expect(collect).toContain('COLLECT_MATCH_DONE_STEP = "COLLECT_MATCH_DONE"');
    expect(collect).toContain("resetPartialMatchCollection");
    expect(collect).toContain('from("raw_observations").delete()');
    expect(collect).toContain("remainingMatches");
    expect(collect).toContain("complete");

    expect(worker).toContain("isPartialStep");
    expect(worker).toContain('status: "STEP_PARTIAL"');
    expect(worker).toContain("p_step: null");
    expect(worker).toContain("p_finished: false");
    expect(worker).toContain('callAdminRuntimeRpc("kick_analysis_worker")');
  });

  it("keeps the final qualification thresholds inclusive and centralized", () => {
    const decisionRules = source("./lib/engine/decision-rules.ts");
    const value = source("./lib/engine/value.ts");

    expect(decisionRules).toContain("MIN_MODEL_PROBABILITY = 0.70");
    expect(decisionRules).toContain("MIN_ENTRY_ODD = 1.70");
    expect(decisionRules).toContain("EV_TARGET = 0.08");
    expect(decisionRules).toContain("MIN_EDGE = 0.05");
    expect(value).toContain('from "./decision-rules"');
    expect(value).toContain("probability >= MIN_MODEL_PROBABILITY");
    expect(value).toContain("odd >= MIN_ENTRY_ODD");
  });

  it("mirrors only the final portfolio to the decision queue", () => {
    const portfolio = source("./lib/engine/portfolio-selection.ts");
    const queue = source("./lib/decision-queue.functions.ts");
    const queueRepository = source("./lib/repositories/decision-queue.repository.server.ts");

    expect(portfolio).toContain("selected.length >= MAX_SELECTIONS");
    expect(portfolio).toContain("selectedMatches.has(row.matchId)");
    expect(portfolio).toContain("familyCount >= 2");
    expect(portfolio).toContain("correlatedAlternates: []");
    expect(queue).toContain("selectExperimentalPortfolio");
    expect(queue).toContain("replaceDecisionQueue");
    expect(queueRepository).toContain('"replace_decision_queue_atomic"');
  });

  it("enforces the same business rule in the Lovable Cloud migration", () => {
    const migration = source("../supabase/migrations/20260912193000_e2e_market_funnel_rules.sql");
    expect(migration).toContain("x.model_probability < 0.70");
    expect(migration).toContain("x.entry_odd < 1.70");
    expect(migration).toContain("x.edge < 0.05");
    expect(migration).toContain("x.expected_value < 0.08");
    expect(migration).toContain("v_rows > 3");
    expect(migration).toContain("having count(*) > 1");
    expect(migration).toContain("having count(*) > 2");
    expect(migration).toContain("interval '10 minutes'");
  });

  it("does not retain the legacy weekday/weekend quota or stale threshold copy", () => {
    const experimental = source("./lib/experimental-markets-run.functions.ts");
    const automaticOdds = source("./lib/auto-bet365-odds.service.server.ts");

    expect(experimental).toContain("MAX_SELECTIONS");
    expect(experimental).toContain("const selectionLimit = MAX_SELECTIONS");
    expect(experimental).not.toContain("selectionLimitForDate");
    expect(experimental).not.toContain("return weekday === 0 || weekday === 6 ? 3 : 2");

    expect(automaticOdds).toContain("confiança >=70%");
    expect(automaticOdds).toContain("odd real precisa ser >=1,70, com EV >=8% e edge >=5 p.p.");
    expect(automaticOdds).not.toContain("confiança >70%");
    expect(automaticOdds).not.toContain("EV mínimo de 2%");
  });

  it("treats zero qualified opportunities as a legitimate result", () => {
    const queue = source("./lib/decision-queue.functions.ts");
    const gate = source("./components/DecisionQueueGate.tsx");
    expect(queue).toContain("Nenhuma aposta atendeu a todos os requisitos da regra de negócio.");
    expect(gate).toContain("Nenhuma opção passou por todos os critérios");
    expect(gate).toContain("Nenhuma aposta artificial foi criada");
  });
});
