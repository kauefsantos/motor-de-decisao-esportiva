import { describe, expect, it } from "vitest";

import {
  EV_TARGET,
  MAX_SELECTIONS,
  MIN_EDGE,
  MIN_ENTRY_ODD,
  MIN_MODEL_PROBABILITY,
} from "./decision-rules";
import { BASE_GATE } from "./opportunity";
import { passesMinimumOddGate, passesModelProbabilityGate } from "./value";

describe("canonical decision rules", () => {
  it("keeps the approved business thresholds in one shared contract", () => {
    expect(MIN_MODEL_PROBABILITY).toBe(0.70);
    expect(BASE_GATE).toBe(MIN_MODEL_PROBABILITY);
    expect(MIN_ENTRY_ODD).toBe(1.70);
    expect(EV_TARGET).toBe(0.08);
    expect(MIN_EDGE).toBe(0.05);
    expect(MAX_SELECTIONS).toBe(3);
  });

  it("treats the probability and odd boundaries as inclusive", () => {
    expect(passesModelProbabilityGate(0.70)).toBe(true);
    expect(passesModelProbabilityGate(0.699999)).toBe(false);
    expect(passesMinimumOddGate(1.70)).toBe(true);
    expect(passesMinimumOddGate(1.699999)).toBe(false);
  });
});
