import { describe, expect, it } from "vitest";

import { ELO_MODEL_VERSION } from "./elo";

describe("Elo model version", () => {
  it("records the experimental weighting in the version", () => {
    expect(ELO_MODEL_VERSION).toBe("elo-v1-w020");
  });
});
