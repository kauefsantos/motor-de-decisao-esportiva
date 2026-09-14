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

describe("Stage 7 calibration production-safety contract", () => {
  it("stores Stage 7 calibrated probabilities in shadow without changing the model status", () => {
    const prepare = source("./lib/application/experimental-markets/prepare-run.server.ts");
    const shadow = stage7ShadowSection(prepare);
    expect(shadow).toContain("row.p_cal = calibrated[side]");
    expect(shadow).toContain("row.calibration_version = calibration.calibrationVersion");
    expect(shadow).not.toContain('row.model_status = "PRODUCTION_VALIDATED"');
    expect(shadow).not.toContain("row.conservative_probability =");
  });

  it("requires an untouched prospective sample and keeps promotion explicit", () => {
    const stage7 = source("./lib/application/training/stage7-1x2-calibration.ts");
    const migration = source("../supabase/migrations/20260914100000_stage7_1x2_calibration_holdout.sql");
    expect(stage7).toContain('STAGE7_PROSPECTIVE_HOLDOUT_START = "2026-09-14"');
    expect(stage7).toContain("STAGE7_MIN_PROSPECTIVE_HOLDOUT_SAMPLE = 200");
    expect(stage7).toContain('"PROSPECTIVE_HOLDOUT_PENDING"');
    expect(stage7).toContain("productionValidated: false");
    expect(migration).toContain("'HOLDOUT_PASSED'");
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
