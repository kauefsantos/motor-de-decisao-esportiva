import { describe, expect, it } from "vitest";
import { CARD_MATCH_OVER_LINES, CARD_MATCH_UNDER_LINES, CARD_TEAM_OVER_LINES, CARD_TEAM_UNDER_LINES, CORNER_OVER_LINES, CORNER_UNDER_LINES, buildContracts } from "./markets";

describe("absolute count market catalogue", () => {
  it("restricts corner limits and makes them binary", () => {
    expect(CORNER_OVER_LINES).toEqual(["4", "5", "6", "7", "8", "9", "10"]);
    expect(CORNER_UNDER_LINES).toEqual(["10", "9", "8", "7", "6", "5"]);
    const corners = buildContracts({ home: "Casa", away: "Fora" }).filter((contract) => contract.family === "CORNERS");
    expect(corners).toHaveLength(39);
    expect(corners.every((contract) => contract.contractType === "BINARY")).toBe(true);
  });

  it("opens yellow-card totals and team markets with restricted limits", () => {
    expect(CARD_MATCH_OVER_LINES).toEqual(["2", "3", "4", "5", "6"]);
    expect(CARD_MATCH_UNDER_LINES).toEqual(["7", "6", "5", "4", "3"]);
    expect(CARD_TEAM_OVER_LINES).toEqual(["0", "1", "2", "3"]);
    expect(CARD_TEAM_UNDER_LINES).toEqual(["4", "3", "2", "1"]);
    const cards = buildContracts({ home: "Casa", away: "Fora" }).filter((contract) => contract.family === "CARDS");
    expect(cards).toHaveLength(26);
    expect(cards.every((contract) => contract.contractType === "BINARY")).toBe(true);
  });
});
