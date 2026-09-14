import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Stage 7B robust calibration governance contract", () => {
  it("keeps internal model selection separate from the untouched retrospective window", () => {
    const stage7b = source("./lib/application/training/stage7b-1x2-calibration.ts");
    expect(stage7b).toContain('STAGE7B_INTERNAL_SELECTION_START = "2026-04-01"');
    expect(stage7b).toContain('STAGE7B_CALIBRATION_END_EXCLUSIVE = "2026-06-01"');
    expect(stage7b).toContain('STAGE7B_RETROSPECTIVE_END_EXCLUSIVE = "2026-09-14"');
    expect(stage7b).toContain("internalSelectionPassed");
    expect(stage7b).toContain("calibrationWithinTolerance");
  });

  it("uses class-wise isotonic shrinkage without weakening the production gates", () => {
    const stage7b = source("./lib/application/training/stage7b-1x2-calibration.ts");
    const rules = source("./lib/engine/decision-rules.ts");
    expect(stage7b).toContain('"classwise_isotonic_blend"');
    expect(stage7b).toContain("doesNotDegradeRawBrier");
    expect(stage7b).toContain("doesNotDegradeRawLogLoss");
    expect(stage7b).toContain("MODEL_VALIDATION_CALIBRATION_TOLERANCE");
    expect(rules).toContain("MIN_MODEL_PROBABILITY = 0.70");
    expect(rules).toContain("MIN_ENTRY_ODD = 1.70");
    expect(rules).toContain("EV_TARGET = 0.08");
    expect(rules).toContain("MIN_EDGE = 0.05");
    expect(rules).toContain("MAX_SELECTIONS = 3");
  });

  it("keeps Stage 7B shadow-only and requires 200 untouched future fixtures", () => {
    const stage7b = source("./lib/application/training/stage7b-1x2-calibration.ts");
    const prepare = source("./lib/application/experimental-markets/prepare-run.server.ts");
    const migration = source("../supabase/migrations/20260914113000_stage7b_1x2_robust_calibration.sql");
    expect(stage7b).toContain("STAGE7B_MIN_PROSPECTIVE_HOLDOUT_SAMPLE = 200");
    expect(stage7b).toContain("productionValidated: false");
    expect(prepare).toContain("conservative_probability");
    expect(prepare).not.toContain('row.model_status = "PRODUCTION_VALIDATED"');
    expect(migration).not.toContain("validation_status='PRODUCTION_VALIDATED'");
  });
});
