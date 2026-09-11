import { describe, expect, it } from "vitest";

import { parseFixtures, teamRelativeStats } from "./five_dollar.parse";

describe("5Dollar compound history research fields", () => {
  it("retains stats/events as research-only team-relative observations", () => {
    const [fixture] = parseFixtures({
      success: 1,
      data: [{
        id: 1,
        league: { id: 129, name: "League" },
        teams: { home: { id: 10, name: "A" }, away: { id: 20, name: "B" } },
        kickoff_ts: 1788000000,
        kickoff_utc: "2026-08-29T00:00:00Z",
        status: "finished",
        goals: { home: 2, away: 1 },
        corners: { home: 7, away: 4 },
        cards: { home: { yellow: 2, red: 0 }, away: { yellow: 1, red: 1 } },
        statistics: {
          attacks: { home: 100, away: 80 },
          dangerous_attacks: { home: 50, away: 30 },
          shots_on_target: { home: 6, away: 3 },
          shots_off_target: { home: 7, away: 4 },
          possession: { home: 58, away: 42 },
          first_half: { attacks: { home: 45, away: 35 }, shots_on_target: { home: 2, away: 1 } },
        },
        events: [
          { type: "corner", minute: 12, team: "home", count: 1 },
          { type: "corner", minute: 25, team: "away", count: 1 },
          { type: "yellow_card", minute: 20, team: "home", count: 1 },
          { type: "red_card", minute: 28, team: "away", count: 1 },
          { type: "corner", minute: 55, team: "home", count: 1 },
        ],
      }],
    });

    expect(fixture).toBeDefined();
    const relative = teamRelativeStats(fixture!, 10, "2026-09-10T12:00:00Z");
    expect(relative).not.toBeNull();
    const byMetric = new Map(relative!.stats.map((row) => [row.canonical, row]));

    expect(byMetric.get("research_attacks_for")?.value).toBe(100);
    expect(byMetric.get("research_attacks_against")?.value).toBe(80);
    expect(byMetric.get("research_shots_on_target_for")?.value).toBe(6);
    expect(byMetric.get("research_corners_first_30_for")?.value).toBe(1);
    expect(byMetric.get("research_corners_first_30_against")?.value).toBe(1);
    expect(byMetric.get("research_card_points_first_30_for")?.value).toBe(1);
    expect(byMetric.get("research_card_points_first_30_against")?.value).toBe(2);
    expect(byMetric.get("research_attacks_for")?.contractCompatible).toBe(false);
  });
});
