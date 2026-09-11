type Row = Record<string, unknown>;

function record(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Row)
    : null;
}

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type LeaguePriorType = "corner" | "card";

export type LeaguePriorRow = {
  leagueId: number;
  priorType: LeaguePriorType;
  season: string | null;
  sourceKind: string | null;
  roundLabel: string | null;
  teamId: number;
  teamName: string;
  played: number | null;
  totalFor: number | null;
  totalAgainst: number | null;
  averageFor: number | null;
  averageAgainst: number | null;
  raw: Row;
};

export function parseLeaguePriorSnapshot(
  payload: unknown,
  expectedType: LeaguePriorType,
): LeaguePriorRow[] {
  const root = record(payload);
  const data = record(root?.["data"]);
  if (!data) return [];

  const leagueId = finite(data["league_id"]);
  const actualType = text(data["type"]);
  if (leagueId === null || actualType !== expectedType) return [];

  const season = text(data["season"]);
  const sourceKind = text(data["source"]);
  const round = data["round"];
  const roundLabel = round === null || round === undefined ? null : String(round);
  const table = Array.isArray(data["table"]) ? data["table"] as unknown[] : [];
  const rows: LeaguePriorRow[] = [];

  for (const item of table) {
    const row = record(item);
    const team = record(row?.["team"]);
    const teamId = finite(team?.["id"]);
    const teamName = text(team?.["name"]);
    if (!row || teamId === null || !teamName) continue;

    rows.push({
      leagueId,
      priorType: expectedType,
      season,
      sourceKind,
      roundLabel,
      teamId,
      teamName,
      played: finite(row["played"]),
      totalFor: finite(row["total_for"]),
      totalAgainst: finite(row["total_against"]),
      averageFor: finite(row["average_for"]),
      averageAgainst: finite(row["average_against"]),
      raw: row,
    });
  }

  return rows;
}
