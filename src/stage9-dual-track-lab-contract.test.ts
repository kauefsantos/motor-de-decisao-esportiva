import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Stage 9 dual-track entertainment and laboratory contract", () => {
  it("keeps the experimental entertainment flow independent from production certification", () => {
    const experimental = source("./lib/experimental-markets-run.functions.ts");
    const production = source("./lib/engine/opportunity.ts");
    const opportunities = source("./routes/run.$runId.oportunidades.tsx");

    expect(experimental).toContain("prepareExperimentalPredictionsForRun");
    expect(experimental).toContain("EXPERIMENTAL_MARKETS_STATUS");
    expect(experimental).toContain("productionStatus: PRODUCTION_STATUS");
    expect(production).toContain('model.validationStatus !== "PRODUCTION_VALIDATED"');
    expect(opportunities).toContain("Modo diversão · experimental ativo");
    expect(opportunities).toContain("O modelo experimental e a Stage 9 continuam separados da validação para uso com dinheiro real");
  });

  it("stores owner-scoped lab notifications without exposing private validation tables to the browser", () => {
    const migration = source("../supabase/migrations/20260914224500_stage9_dual_track_lab_notifications.sql");
    const server = source("./lib/model-lab.functions.ts");
    const component = source("./components/ModelLabNotifications.tsx");

    expect(migration).toContain("create table if not exists private.model_lab_events");
    expect(migration).toContain("where e.owner_id=p_owner_id");
    expect(migration).toContain("revoke all on table private.model_lab_events from public,anon,authenticated");
    expect(migration).toContain("grant execute on function public.get_model_lab_events(uuid,integer) to service_role");
    expect(server).toContain("context.userId");
    expect(server).toContain('callRuntimeRpc<ModelLabEvent[]>(db, "get_model_lab_events"');
    expect(component).toContain('refetchInterval: 60_000');
    expect(component).toContain("O modo diversão continua ativo");
  });

  it("runs the laboratory daily in Sao Paulo time and does not repeat a finished fixed experiment on the same day", () => {
    const migration = source("../supabase/migrations/20260914224500_stage9_dual_track_lab_notifications.sql");

    expect(migration).toContain("create or replace function public.kick_stage9_daily_lab()");
    expect(migration).toContain("stage9-daily-lab");
    expect(migration).toContain("America/Sao_Paulo");
    expect(migration).toContain("('06:15','06:20')");
    expect(migration).toContain("ALREADY_RAN_TODAY");
    expect(migration).toContain("LAB_WAITING_");
    expect(migration).toContain("public.kick_stage9_1x2_calibration()");
    expect(migration).toContain("public.kick_stage9_1x2_holdout()");
  });

  it("does not relax the canonical money or production-validation gates", () => {
    const rules = source("./lib/engine/decision-rules.ts");
    const stage9 = source("./lib/application/training/stage9-1x2-ensemble-calibration.ts");
    const migration = source("../supabase/migrations/20260914224500_stage9_dual_track_lab_notifications.sql");

    expect(rules).toContain("MIN_MODEL_PROBABILITY = 0.70");
    expect(rules).toContain("MIN_ENTRY_ODD = 1.70");
    expect(rules).toContain("EV_TARGET = 0.08");
    expect(rules).toContain("MIN_EDGE = 0.05");
    expect(rules).toContain("MAX_SELECTIONS = 3");
    expect(stage9).toContain("STAGE9_MIN_PROSPECTIVE_HOLDOUT_SAMPLE = 200");
    expect(stage9).toContain("MODEL_VALIDATION_CALIBRATION_TOLERANCE");
    expect(migration).not.toContain("MIN_MODEL_PROBABILITY =");
    expect(migration).not.toContain("MIN_ENTRY_ODD =");
  });
});
