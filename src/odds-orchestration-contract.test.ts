import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("automatic odds orchestration", () => {
  it("runs Bet365 pricing as the last background pipeline step", () => {
    const steps = source("./lib/pipeline.steps.ts");
    const pipeline = source("./lib/pipeline.server.ts");

    expect(steps).toContain('{ key: "ODDS", label: "Buscando as odds da Bet365" }');
    expect(steps.indexOf('key: "ODDS"')).toBeGreaterThan(steps.indexOf('key: "MARKETS"'));
    expect(pipeline).toContain('case "ODDS": return odds(db, runId);');
    expect(pipeline).toContain("collectAutomaticBet365OddsForRun(db, runId)");
    expect(pipeline).toContain('status: "READY_FOR_ODDS"');
    expect(pipeline).toContain('current_step: "ODDS"');
  });

  it("refreshes automatic odds before building the final decision queue", () => {
    const flow = source("./components/DecisionQueueFlow.tsx");
    const refreshIndex = flow.indexOf("const refreshed = await collectAutoOdds");
    const buildIndex = flow.indexOf("const result = await buildQueue");

    expect(refreshIndex).toBeGreaterThanOrEqual(0);
    expect(buildIndex).toBeGreaterThan(refreshIndex);
    expect(flow).toContain("buildConfirmedQuoteEntries");
    expect(flow).toContain("Avaliar oportunidades");
    expect(flow).toContain("As probabilidades da análise não são refeitas");
  });

  it("shares one server-side collector between the scheduled pipeline and authenticated UI", () => {
    const functions = source("./lib/auto-bet365-odds.functions.ts");
    const pipeline = source("./lib/pipeline.server.ts");

    expect(functions).toContain("collectAutomaticBet365OddsForRun");
    expect(pipeline).toContain("collectAutomaticBet365OddsForRun");
  });
});
