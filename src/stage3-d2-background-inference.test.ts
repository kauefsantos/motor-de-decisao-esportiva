import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Stage 3 D+2 background inference", () => {
  it("uses one shared prediction preparation service for worker and authenticated UI", () => {
    const service = source("./lib/application/experimental-markets/prepare-run.server.ts");
    const wrapper = source("./lib/experimental-markets-run.functions.ts");
    const pipeline = source("./lib/pipeline.server.ts");

    expect(service).toContain("buildExperimentalPredictions");
    expect(service).toContain("insertExperimentalPredictions");
    expect(service).toContain("clearExperimentalPredictions");
    expect(service).toContain("EXPERIMENTAL_CURRENT_SEASON");
    expect(service).toContain("MODEL_NOT_PRODUCTION_VALIDATED");

    expect(wrapper).toContain("prepareExperimentalPredictionsForRun(db, data.runId)");
    expect(wrapper).not.toContain("buildExperimentalPredictions({");
    expect(pipeline).toContain("prepareExperimentalPredictionsForRun(db, runId)");
  });

  it("fails closed when inference produces no persisted prediction", () => {
    const pipeline = source("./lib/pipeline.server.ts");

    expect(pipeline).toContain("prepared.predictionCount === 0");
    expect(pipeline).toContain("Nenhuma previsão pôde ser preparada com segurança");
    expect(pipeline).toContain('.from("model_predictions")');
    expect(pipeline).toContain('.eq("model_status", EXPERIMENTAL_MARKETS_STATUS)');
    expect(pipeline).toContain("READY_FOR_ODDS bloqueado: nenhuma previsão persistida");

    const guard = pipeline.indexOf("READY_FOR_ODDS bloqueado: nenhuma previsão persistida");
    const ready = pipeline.indexOf('status: "READY_FOR_ODDS"');
    expect(guard).toBeGreaterThan(-1);
    expect(ready).toBeGreaterThan(guard);
  });

  it("repairs the partial-index conflict regression without weakening dispatcher access", () => {
    const migration = source("../supabase/migrations/20260913170000_stage3_d2_background_inference.sql");

    expect(migration.toLowerCase()).not.toContain("on conflict(request_id)");
    expect(migration.toLowerCase()).toContain("on conflict do nothing");
    expect(migration).toContain("revoke all on function public.kick_scheduled_daily_analysis() from public,anon,authenticated");
    expect(migration).toContain("grant execute on function public.kick_scheduled_daily_analysis() to service_role");
  });
});
