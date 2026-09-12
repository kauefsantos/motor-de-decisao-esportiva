import { describe, expect, it } from "vitest";

import { parseLeaguePriorSnapshot } from "./five_dollar.standings";

describe("5Dollar league prior parser", () => {
  it("keeps point-in-time corner table values and metadata", () => {
    const rows = parseLeaguePriorSnapshot({
      success: 1,
      data: {
        league_id: 129,
        season: "2026",
        type: "corner",
        source: "feed",
        round: 24,
        table: [
          {
            position: 1,
            team: { id: 10, name: "A" },
            played: 20,
            total_for: 120,
            total_against: 80,
            average_for: 6,
            average_against: 4,
            first_half: { total_for: 55, average_for: 2.75 },
          },
        ],
      },
    }, "corner");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      leagueId: 129,
      priorType: "corner",
      season: "2026",
      sourceKind: "feed",
      roundLabel: "24",
      teamId: 10,
      played: 20,
      averageFor: 6,
      averageAgainst: 4,
    });
    expect(rows[0]?.raw["first_half"]).toEqual({ total_for: 55, average_for: 2.75 });
  });

  it("rejects a response with a different table type", () => {
    expect(parseLeaguePriorSnapshot({
      success: 1,
      data: { league_id: 129, type: "card", table: [] },
    }, "corner")).toEqual([]);
  });
});
