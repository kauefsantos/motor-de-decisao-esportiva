import type { FiveDollarFixture } from "./adapters/five_dollar.parse";
import { addSaoPauloCalendarDays, saoPauloLocalDate } from "./sao-paulo-time";

export const SCHEDULED_ANALYSIS_ORIGIN = "SCHEDULED_D2";

export type ScheduledFixturePayload = {
  event_id: number;
  home_team_id: number;
  away_team_id: number;
  league_id: number;
  home_name: string;
  away_name: string;
  competition: string;
  kickoff_at: string;
};

export function scheduledTargetDate(now = new Date(), offsetDays = 2) {
  if (!Number.isInteger(offsetDays) || offsetDays < 1 || offsetDays > 7) {
    throw new Error(`Deslocamento D+ inválido: ${offsetDays}`);
  }
  return addSaoPauloCalendarDays(saoPauloLocalDate(now), offsetDays);
}

function kickoffIso(fixture: FiveDollarFixture) {
  if (fixture.kickoffIso && Number.isFinite(Date.parse(fixture.kickoffIso))) return fixture.kickoffIso;
  if (fixture.startTimestamp !== null && Number.isFinite(fixture.startTimestamp)) {
    return new Date(fixture.startTimestamp * 1000).toISOString();
  }
  return null;
}

export function selectScheduledFixtures(
  fixtures: FiveDollarFixture[],
  allowedCompetitionIds: ReadonlySet<number>,
): ScheduledFixturePayload[] {
  const seenFixtureIds = new Set<number>();
  const selected: ScheduledFixturePayload[] = [];

  for (const fixture of fixtures) {
    const kickoff = kickoffIso(fixture);
    if (fixture.statusType !== "notstarted") continue;
    if (fixture.leagueId === null || !allowedCompetitionIds.has(fixture.leagueId)) continue;
    if (fixture.homeTeamId === null || fixture.awayTeamId === null) continue;
    if (!kickoff || !fixture.homeName.trim() || !fixture.awayName.trim() || !fixture.tournament.trim()) continue;
    if (seenFixtureIds.has(fixture.eventId)) continue;

    seenFixtureIds.add(fixture.eventId);
    selected.push({
      event_id: fixture.eventId,
      home_team_id: fixture.homeTeamId,
      away_team_id: fixture.awayTeamId,
      league_id: fixture.leagueId,
      home_name: fixture.homeName.trim(),
      away_name: fixture.awayName.trim(),
      competition: fixture.tournament.trim(),
      kickoff_at: kickoff,
    });
  }

  return selected.sort((a, b) => Date.parse(a.kickoff_at) - Date.parse(b.kickoff_at) || a.event_id - b.event_id);
}
