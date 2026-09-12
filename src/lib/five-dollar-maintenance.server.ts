import { parseLeaguePriorSnapshot, type LeaguePriorType } from "./adapters/five_dollar.standings";
import { fiveDollarApiStatus, fiveDollarGet } from "./adapters/five_dollar.server";

function saoPauloDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function plusDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function runFiveDollarMaintenance() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const today = saoPauloDate();
  const through = plusDays(today, 2);
  const status = await fiveDollarApiStatus();

  const { data: runs } = await db
    .from("analysis_runs")
    .select("id,target_date")
    .gte("target_date", today)
    .lte("target_date", through)
    .order("target_date", { ascending: true });
  const runIds = (runs ?? []).map((row: any) => row.id);
  const { data: matches } = runIds.length
    ? await db.from("matches").select("id,run_id").in("run_id", runIds)
    : { data: [] };
  const matchIds = (matches ?? []).map((row: any) => row.id);
  const { data: externalIds } = matchIds.length
    ? await db.from("match_external_ids").select("match_id,external_id").in("match_id", matchIds).eq("source", "five_dollar_league")
    : { data: [] };

  const frequency = new Map<number, number>();
  for (const row of externalIds ?? []) {
    const leagueId = Number(row.external_id);
    if (Number.isFinite(leagueId)) frequency.set(leagueId, (frequency.get(leagueId) ?? 0) + 1);
  }
  const leagueIds = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([id]) => id);

  const { data: existing } = leagueIds.length
    ? await db.from("five_dollar_league_priors").select("league_id,prior_type").eq("snapshot_date", today).in("league_id", leagueIds)
    : { data: [] };
  const existingKeys = new Set((existing ?? []).map((row: any) => `${row.league_id}:${row.prior_type}`));
  const needs = leagueIds.filter((id) => !existingKeys.has(`${id}:corner`) || !existingKeys.has(`${id}:card`));
  // /status + at most six standings calls => stays under the 9/minute operational cap.
  const selected = needs.slice(0, 3);

  let calls = status.fetched.fromCache ? 0 : 1;
  let rowsWritten = 0;
  let capturedLeagues = 0;
  for (const leagueId of selected) {
    let captured = false;
    for (const priorType of ["corner", "card"] as const satisfies readonly LeaguePriorType[]) {
      if (existingKeys.has(`${leagueId}:${priorType}`)) continue;
      const fetched = await fiveDollarGet(`/standings?league=${leagueId}&type=${priorType}`);
      if (!fetched.fromCache) calls += 1;
      if (fetched.status !== "OK" || fetched.payload === null) continue;
      const parsed = parseLeaguePriorSnapshot(fetched.payload, priorType);
      if (parsed.length === 0) continue;
      const { error } = await db.from("five_dollar_league_priors").upsert(parsed.map((row) => ({
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
        snapshot_date: today,
        snapshot_at: fetched.fetchedAt,
        updated_at: new Date().toISOString(),
      })), { onConflict: "league_id,prior_type,team_id,snapshot_date" });
      if (error) throw new Error("Falha ao salvar prior de standings.");
      rowsWritten += parsed.length;
      captured = true;
    }
    if (captured) capturedLeagues += 1;
  }

  const { data: cacheDeleted } = await db.rpc("cleanup_external_api_cache");
  return {
    status: "OK" as const,
    checkedAt: new Date().toISOString(),
    providerPlan: status.plan,
    providerLimit: status.limit,
    statusFetch: status.fetched.status,
    targetWindow: { from: today, through },
    relevantLeagues: leagueIds.length,
    capturedLeagues,
    deferredLeagues: Math.max(0, needs.length - selected.length),
    rowsWritten,
    externalCalls: calls,
    expiredCacheRowsDeleted: Number(cacheDeleted ?? 0),
  };
}
