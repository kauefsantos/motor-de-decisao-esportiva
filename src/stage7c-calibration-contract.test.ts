import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function stage7ShadowSection(prepare: string) {
  const start = prepare.indexOf("async function applyStage7ShadowCalibration");
  const end = prepare.indexOf("async function applyStage9GovernedCalibration");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return prepare.slice(start, end);
}

describe("Stage 7C joint calibration production-safety contract", () => {
  it("selects vector/Dirichlet only on the internal window and leaves the retrospective window untouched", () => {
    const stage7c = source("./lib/application/training/stage7c-1x2-calibration.ts");
    expect(stage7c).toContain('["vector_scaling", "dirichlet"]');
    expect(stage7c).toContain('STAGE7C_INTERNAL_SELECTION_START = "2026-04-01"');
    expect(stage7c).toContain('STAGE7C_CALIBRATION_END_EXCLUSIVE = "2026-06-01"');
    expect(stage7c).toContain('STAGE7C_RETROSPECTIVE_END_EXCLUSIVE = "2026-09-14"');
    expect(stage7c).toContain("selectHyperparameters(fitRows, selectionRows)");
    expect(stage7c).toContain("shadowCalibratedMetrics.maxCalibrationGap <= MODEL_VALIDATION_CALIBRATION_TOLERANCE");
  });

  it("keeps joint calibration shadow-only and requires a 200-fixture prospective holdout", () => {
    const stage7c = source("./lib/application/training/stage7c-1x2-calibration.ts");
    const prepare = source("./lib/application/experimental-markets/prepare-run.server.ts");
    const shadow = stage7ShadowSection(prepare);
    expect(stage7c).toContain("STAGE7C_MIN_PROSPECTIVE_HOLDOUT_SAMPLE = 200");
    expect(stage7c).toContain("productionValidated: false");
    expect(shadow).toContain('calibration.method === "classwise_isotonic_blend"');
    expect(shadow).toContain("applyOneXTwoJointCalibration");
    expect(shadow).not.toContain('row.model_status = "PRODUCTION_VALIDATED"');
    expect(shadow).not.toContain("row.conservative_probability =");
  });

  it("contains no automatic production promotion path in Lovable Cloud persistence", () => {
    const migration = source("../supabase/migrations/20260914120000_stage7c_1x2_joint_calibration.sql");
    expect(migration).toContain("'NOT_PRODUCTION_VALIDATED'");
    expect(migration).toContain("'SHADOW_READY'");
    expect(migration).not.toContain("validation_status='PRODUCTION_VALIDATED'");
  });

  it("does not alter the canonical money gates", () => {
    const rules = source("./lib/engine/decision-rules.ts");
    expect(rules).toContain("MIN_MODEL_PROBABILITY = 0.70");
    expect(rules).toContain("MIN_ENTRY_ODD = 1.70");
    expect(rules).toContain("EV_TARGET = 0.08");
    expect(rules).toContain("MIN_EDGE = 0.05");
    expect(rules).toContain("MAX_SELECTIONS = 3");
  });
});
