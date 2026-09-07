import { describe, expect, it } from "vitest";

import { updateElo } from "./elo";

describe("elo temporal discipline", () => {
  it("can be replayed strictly in chronological order", () => {
    const matches = [
      { date: "2026-01-01", home: "A", away: "B", hg: 1, ag: 0 },
      { date: "2026-01-08", home: "B", away: "A", hg: 2, ag: 0 },
    ];
    const predictionAt = "2026-01-05";
    const ratings = new Map<string, number>([["A", 1500], ["B", 1500]]);

    for (const match of matches.filter((m) => m.date < predictionAt)) {
      const result = updateElo({
        homeRating: ratings.get(match.home) ?? 1500,
        awayRating: ratings.get(match.away) ?? 1500,
        homeGoals: match.hg,
        awayGoals: match.ag,
      });
      ratings.set(match.home, result.homeAfter);
      ratings.set(match.away, result.awayAfter);
    }

    expect(ratings.get("A")).toBeGreaterThan(1500);
    expect(ratings.get("B")).toBeLessThan(1500);
  });
});
