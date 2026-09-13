import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const route = fs.readFileSync(path.join(root, "src/routes/api.model-validation.ts"), "utf8");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260913200000_stage4_corners_walk_forward.sql"),
  "utf8",
);
const validator = fs.readFileSync(
  path.join(root, "src/lib/application/training/corners-walk-forward.ts"),
  "utf8",
);

describe("Stage 4 corners validation contract", () => {
  it("requires a one-time job dispatch token and never exposes a GET execution path", () => {
    expect(route).toContain('dispatchToken');
    expect(route).toContain('claim_model_validation');
    expect(route).toContain('stage4-corners-walk-forward-v1');
    expect(route).toContain('Method Not Allowed');
  });

  it("does not promote or calibrate a model as a side effect of validation", () => {
    expect(migration).toContain("'NOT_PRODUCTION_VALIDATED'");
    expect(migration).toContain("calibration_version");
    const completion = migration.split("create or replace function public.complete_stage4_model_validation")[1] ?? "";
    expect(completion.split("create or replace function public.kick_stage4_corners_validation")[0]).not.toContain("validation_status=");
    expect(validator).not.toContain('PRODUCTION_VALIDATED');
  });

  it("keeps the point-in-time same-day exclusion explicit", () => {
    expect(validator).toContain("row.date < target.date");
    expect(validator).toContain("STAGE4_CORNERS_LOOKBACK_DAYS = 365");
  });
});
