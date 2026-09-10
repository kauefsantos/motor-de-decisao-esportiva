import { describe, expect, it } from "vitest";

import { CORNER_OVER_LINES, CORNER_UNDER_LINES, buildContracts } from "./markets";

describe("corner line catalogue", () => {
  it("covers OVER 0..10 and UNDER 1..11 for match and both teams", () => {
    expect(CORNER_OVER_LINES).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(CORNER_UNDER_LINES).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);

    const contracts = buildContracts({ home: "Casa", away: "Fora" });
    const corners = contracts.filter((contract) => contract.family === "CORNERS");
    expect(corners).toHaveLength(66);

    const matchOvers = corners
      .filter((contract) => contract.scope === "MATCH" && contract.side === "OVER")
      .map((contract) => contract.lineRaw);
    const matchUnders = corners
      .filter((contract) => contract.scope === "MATCH" && contract.side === "UNDER")
      .map((contract) => contract.lineRaw);
    expect(matchOvers).toEqual(CORNER_OVER_LINES);
    expect(matchUnders).toEqual(CORNER_UNDER_LINES);
  });
});
