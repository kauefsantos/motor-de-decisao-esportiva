import { describe, expect, it } from "vitest";

import { saoPauloLocalDateTimeToIso } from "./lib/sao-paulo-time";

describe("America/Sao_Paulo local time conversion", () => {
  it("uses historical DST offset instead of hard-coded UTC-3", () => {
    expect(saoPauloLocalDateTimeToIso("2019-02-16", "12:00")).toBe("2019-02-16T14:00:00.000Z");
  });

  it("uses standard UTC-3 after Brazilian DST was abolished", () => {
    expect(saoPauloLocalDateTimeToIso("2026-09-12", "12:00")).toBe("2026-09-12T15:00:00.000Z");
  });
});
