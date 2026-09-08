import { describe, expect, it } from "vitest";

import {
  crossLeagueCornersForecast,
  crossLeagueGoalForecast,
  primaryDomesticLeague,
} from "./cross-league";
import type { CornerMatchRow } from "./corners";
import type { GoalMatchRow } from "./goals";

const goals: GoalMatchRow[] = [
  { date: "2026-08-01", league: "spain-la-liga", homeTeam: "A", awayTeam: "X", homeGoals: 2, awayGoals: 0 },
  { date: "2026-08-05", league: "spain-la-liga", homeTeam: "Y", awayTeam: "A", homeGoals: 1, awayGoals: 2 },
  { date: "2026-08-10", league: "spain-la-liga", homeTeam: "A", awayTeam: "Z", homeGoals: 3, awayGoals: 1 },
  { date: "2026-08-02", league: "netherlands-eredivisie", homeTeam: "B", awayTeam: "M", homeGoals: 1, awayGoals: 1 },
  { date: "2026-08-06", league: "netherlands-eredivisie", homeTeam: "N", awayTeam: "B", homeGoals: 1, awayGoals: 2 },
  { date: "2026-08-11", league: "netherlands-eredivisie", homeTeam: "B", awayTeam: "O", homeGoals: 2, awayGoals: 1 },
  { date: "2026-08-20", league: "uefa-champions-league", homeTeam: "A", awayTeam: "Q", homeGoals: 1, awayGoals: 0 },
];

const corners: CornerMatchRow[] = goals.slice(0, 6).map((r, i) => ({
  date: r.date,
  league: r.league,
  homeTeam: r.homeTeam,
  awayTeam: r.awayTeam,
  homeCorners: 4 + (i % 3),
  awayCorners: 3 + (i % 2),
}));

describe("cross-league domestic fallback", () => {
  it("ignora competição continental ao escolher liga doméstica", () => {
    expect(primaryDomesticLeague(goals, "A")).toEqual({ league: "spain-la-liga", matches: 3 });
  });

  it("gera lambdas de gols apenas quando ambos têm amostra doméstica", () => {
    const out = crossLeagueGoalForecast(goals, {
      homeTeam: "A",
      awayTeam: "B",
      referenceDate: "2026-09-01",
    });
    expect(out).not.toBeNull();
    expect(out!.homeDomesticLeague).toBe("spain-la-liga");
    expect(out!.awayDomesticLeague).toBe("netherlands-eredivisie");
    expect(out!.sampleSize).toBeGreaterThanOrEqual(3);
    expect(out!.lambdaHome).toBeGreaterThan(0);
    expect(out!.lambdaAway).toBeGreaterThan(0);
  });

  it("gera previsão conservadora de corners com ligas domésticas distintas", () => {
    const out = crossLeagueCornersForecast(corners, { homeTeam: "A", awayTeam: "B" });
    expect(out).not.toBeNull();
    expect(out!.lambdaTotal).toBeCloseTo(out!.lambdaHome + out!.lambdaAway, 10);
  });

  it("bloqueia se um time não possui três partidas domésticas", () => {
    expect(crossLeagueGoalForecast(goals, {
      homeTeam: "A",
      awayTeam: "Q",
      referenceDate: "2026-09-01",
    })).toBeNull();
  });
});
