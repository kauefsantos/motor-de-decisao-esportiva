import { describe, expect, it } from "vitest";

import { saoPauloLocalDateTimeToIso, saoPauloLocalDayUnixWindow } from "./sao-paulo-time";

describe("America/Sao_Paulo timezone conversion", () => {
  it("uses current standard UTC-3 without hard-coding the offset", () => {
    expect(saoPauloLocalDateTimeToIso("2026-09-12", "12:00")).toBe("2026-09-12T15:00:00.000Z");
  });

  it("honors historical daylight saving UTC-2", () => {
    expect(saoPauloLocalDateTimeToIso("2019-01-15", "12:00")).toBe("2019-01-15T14:00:00.000Z");
    const window = saoPauloLocalDayUnixWindow("2019-01-15");
    expect(new Date(window.start * 1000).toISOString()).toBe("2019-01-15T02:00:00.000Z");
    expect(new Date(window.end * 1000).toISOString()).toBe("2019-01-16T02:00:00.000Z");
  });
});
