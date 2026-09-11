import { fiveDollarGet } from "./adapters/five_dollar.server";
import {
  parseLeaguePriorSnapshot,
  type LeaguePriorType,
} from "./adapters/five_dollar.standings";

type Db = {
  from: (table: string) => any;
};

function saoPauloDate(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Capture current corner/card standings as point-in-time research priors.
 *
 * Safety rules:
 * - never fetch a current standings table for a historical prediction date;
 * - never feed these rows into probabilities directly;
 * - bound cold-start API work per run so interactive odds collection is not
 *   dominated by standings calls;
 * - reuse today's persisted snapshot across runs.
 */
export async function captureFiveDollarLeaguePriorsForRun(
  db: Db,
  runId: string,
  predictionAt: string,
  maxColdLeagues = 2,
) {
  const snapshotDate = saoPauloDate(new Date());
  const predictionDate = saoPauloDate(predictionAt);
  if (predictionDate !== snapshotDate) {
    return {
      status: "SKIPPED_HISTORICAL" as const,
      snapshotDate,
      capturedLeagues: 0,
      deferredLeagues: 0,
      apiCalls: 0,
      rows: 0,
    };
  }

  const { data: matches } = await db
    .from("matches")
    .select("id")
    .eq("run_id", runId);
  const matchIds = (matches ?? []).map((row: { id: string }) => row.id);
  if (matchIds.length === 0) {
    return { status: "NO_LEAGUES" as const, snapshotDate, capturedLeagues: 0, deferredLeagues: 0, apiCalls: 0, rows: 0 };
  }

  const { data: externalIds } = await db
    .from("match_external_ids")
    .select("match_id,external_id")
    .in("match_id", matchIds)
    .eq("source", "five_dollar_league");

  const counts = new Map<number, number>();
  for (const row of externalIds ?? []) {
    const leagueId = Number(row.external_id);
    if (!Number.isFinite(leagueId)) continue;
    counts.set(leagueId, (counts.get(leagueId) ?? 0) + 1);
  }
  const leagueIds = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([id]) => id);
  if (leagueIds.length === 0) {
    return { status: "NO_LEAGUES" as const, snapshotDate, capturedLeagues: 0, deferredLeagues: 0, apiCalls: 0, rows: 0 };
  }

  const { data: existing } = await db
    .from("five_dollar_league_priors")
    .select("league_id,prior_type")
    .eq("snapshot_date", snapshotDate)
    .in("league_id", leagueIds);
  const existingKeys = new Set((existing ?? []).map((row: { league_id: number; prior_type: string }) => `${row.league_id}:${row.prior_type}`));
  const needs = leagueIds.filter((leagueId) =>
    !existingKeys.has(`${leagueId}:corner`) || !existingKeys.has(`${leagueId}:card`),
  );
  const selected = needs.slice(0, Math.max(0, maxColdLeagues));

  let apiCalls = 0;
  let insertedRows = 0;
  let capturedLeagues = 0;
  for (const leagueId of selected) {
    let leagueCaptured = false;
    for (const priorType of ["corner", "card"] as const satisfies readonly LeaguePriorType[]) {
      if (existingKeys.has(`${leagueId}:${priorType}`)) continue;
      const fetched = await fiveDollarGet(`/standings?league=${leagueId}&type=${priorType}`);
      if (!fetched.fromCache) apiCalls += 1;
      await db.from("source_fetches").insert({
        run_id: runId,
        match_id: null,
        source: `five_dollar_standings_${priorType}`,
        status: fetched.status === "OK" ? "OK" : fetched.status === "RATE_LIMITED" ? "RATE_LIMITED" : "SOURCE_UNAVAILABLE",
        http_status: fetched.httpStatus,
        error_message: fetched.errorMessage,
        fetched_at: fetched.fetchedAt,
      });
      if (fetched.status !== "OK" || fetched.payload === null) continue;

      const rows = parseLeaguePriorSnapshot(fetched.payload, priorType);
      if (rows.length === 0) continue;
      const { error } = await db.from("five_dollar_league_priors").upsert(
        rows.map((row) => ({
          league_id: row.leagueId,
          prior_type: row.priorType,
          season: row.season,
          source_kind: row.sourceKind,
          round_label: row.roundLabel,
          team_id: row.teamId,
          team_name: row.teamName,
          played: row.played,
          total_for: row.totalFor,
          total_against: row.totalAgainst,
          average_for: row.averageFor,
          average_against: row.averageAgainst,
          raw: row.raw,
          snapshot_date: snapshotDate,
          snapshot_at: fetched.fetchedAt,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "league_id,prior_type,team_id,snapshot_date" },
      );
      if (error) throw new Error(`Falha ao persistir standings ${priorType}: ${error.message}`);
      insertedRows += rows.length;
      leagueCaptured = true;
    }
    if (leagueCaptured) capturedLeagues += 1;
  }

  return {
    status: "OK" as const,
    snapshotDate,
    capturedLeagues,
    deferredLeagues: Math.max(0, needs.length - selected.length),
    apiCalls,
    rows: insertedRows,
  };
}
