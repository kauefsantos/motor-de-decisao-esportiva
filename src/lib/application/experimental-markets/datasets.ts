import { bet365CardPointsProxy, type CardMatchRow } from "../../engine/cards";
import type { CornerMatchRow } from "../../engine/corners";
import type { GoalMatchRow } from "../../engine/goals";
import type { RawValue, RunRawRow } from "./contracts";

export function asRecord(value: unknown): RawValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RawValue)
    : null;
}

export function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function leagueFromExternalMatchId(externalMatchId: string): string {
  return externalMatchId.split(":")[0] ?? "";
}

export function mostFrequentLeague(raws: RunRawRow[], matchId: string) {
  const counts = new Map<string, number>();
  for (const row of raws) {
    if (row.match_id !== matchId) continue;
    const rawValue = asRecord(row.raw_value);
    const league = leagueFromExternalMatchId(String(rawValue?.["externalMatchId"] ?? ""));
    if (!league) continue;
    counts.set(league, (counts.get(league) ?? 0) + 1);
  }
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0]?.[0] ?? null;
}

export function buildDatasets(observations: RawValue[]) {
  const corners = new Map<string, CornerMatchRow>();
  const goals = new Map<string, GoalMatchRow>();
  const cardParts = new Map<
    string,
    Partial<CardMatchRow> & {
      homeYellow?: number;
      homeRed?: number;
      awayYellow?: number;
      awayRed?: number;
    }
  >();
  const conflicts = new Set<string>();

  for (const rawValue of observations) {
    const externalMatchId = String(rawValue["externalMatchId"] ?? "");
    const date = String(rawValue["fixtureDate"] ?? "");
    const league = leagueFromExternalMatchId(externalMatchId);
    const raw = asRecord(rawValue["rawHomeAway"]);
    const teamId = String(rawValue["teamId"] ?? rawValue["teamExternalId"] ?? "");
    const opponentId = String(rawValue["opponentId"] ?? "");
    const side = String(rawValue["teamSideInFixture"] ?? "");
    if (!externalMatchId || !date || !league || !teamId || !opponentId) continue;
    if (side !== "HOME" && side !== "AWAY") continue;

    const homeTeam = side === "HOME" ? teamId : opponentId;
    const awayTeam = side === "HOME" ? opponentId : teamId;
    const metric = String(rawValue["metricLabelRaw"] ?? rawValue["sourceLabel"] ?? "");
    const cardValue = finiteNumber(rawValue["value"]);
    if (
      cardValue !== null &&
      (metric === "cards.home.yellow" || metric === "cards.home.red" ||
        metric === "cards.away.yellow" || metric === "cards.away.red")
    ) {
      const part = cardParts.get(externalMatchId) ?? { date, league, homeTeam, awayTeam };
      part.date = date;
      part.league = league;
      part.homeTeam = homeTeam;
      part.awayTeam = awayTeam;
      if (metric === "cards.home.yellow") part.homeYellow = cardValue;
      if (metric === "cards.home.red") part.homeRed = cardValue;
      if (metric === "cards.away.yellow") part.awayYellow = cardValue;
      if (metric === "cards.away.red") part.awayRed = cardValue;
      cardParts.set(externalMatchId, part);
    }

    if (!raw) continue;
    const homeCorners = finiteNumber(raw["cornersHome"]);
    const awayCorners = finiteNumber(raw["cornersAway"]);
    const homeGoals = finiteNumber(raw["goalsHome"]);
    const awayGoals = finiteNumber(raw["goalsAway"]);

    if (homeCorners !== null && awayCorners !== null) {
      const next: CornerMatchRow = { date, league, homeTeam, awayTeam, homeCorners, awayCorners };
      const previous = corners.get(externalMatchId);
      if (previous && (previous.homeTeam !== next.homeTeam || previous.awayTeam !== next.awayTeam || previous.homeCorners !== next.homeCorners || previous.awayCorners !== next.awayCorners)) {
        conflicts.add(externalMatchId);
      } else corners.set(externalMatchId, next);
    }

    if (homeGoals !== null && awayGoals !== null) {
      const next: GoalMatchRow = { date, league, homeTeam, awayTeam, homeGoals, awayGoals };
      const previous = goals.get(externalMatchId);
      if (previous && (previous.homeTeam !== next.homeTeam || previous.awayTeam !== next.awayTeam || previous.homeGoals !== next.homeGoals || previous.awayGoals !== next.awayGoals)) {
        conflicts.add(externalMatchId);
      } else goals.set(externalMatchId, next);
    }
  }

  const cards: CardMatchRow[] = [];
  for (const [id, part] of cardParts) {
    if (conflicts.has(id)) continue;
    if (!part.date || !part.league || !part.homeTeam || !part.awayTeam) continue;
    if (part.homeYellow === undefined || part.homeRed === undefined || part.awayYellow === undefined || part.awayRed === undefined) continue;
    cards.push({
      date: part.date,
      league: part.league,
      homeTeam: part.homeTeam,
      awayTeam: part.awayTeam,
      homeCards: bet365CardPointsProxy(part.homeYellow, part.homeRed),
      awayCards: bet365CardPointsProxy(part.awayYellow, part.awayRed),
    });
  }

  for (const id of conflicts) {
    corners.delete(id);
    goals.delete(id);
  }

  return { corners: [...corners.values()], goals: [...goals.values()], cards };
}

export type ExperimentalDatasets = ReturnType<typeof buildDatasets>;
