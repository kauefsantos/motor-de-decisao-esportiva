import { normalizeTeamName } from "./adapters/football.shared";
import {
  fiveDollarGet,
  fiveDollarResetUsage,
  fiveDollarUsage,
} from "./adapters/five_dollar.server";
import {
  externalMatchKey,
  parseFixtures,
  type FiveDollarFixture,
} from "./adapters/five_dollar.parse";
import {
  ELO_INITIAL_RATING,
  ELO_MODEL_VERSION,
  homeAdvantageFromPast,
  updateElo,
} from "./engine/elo";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Row = Record<string, unknown>;
type DbError = { message: string } | null;
type DbResponse = { data: unknown; error: DbError; count?: number | null };

interface DbQuery extends PromiseLike<DbResponse> {
  select(columns?: string, options?: Record<string, unknown>): DbQuery;
  eq(column: string, value: unknown): DbQuery;
  lt(column: string, value: unknown): DbQuery;
  lte(column: string, value: unknown): DbQuery;
  gte(column: string, value: unknown): DbQuery;
  order(column: string, options?: Record<string, unknown>): DbQuery;
  limit(value: number): DbQuery;
  range(from: number, to: number): DbQuery;
  single(): DbQuery;
  maybeSingle(): DbQuery;
  insert(values: unknown): DbQuery;
  upsert(values: unknown, options?: Record<string, unknown>): DbQuery;
  delete(): DbQuery;
}

interface UntypedDb {
  from(table: string): DbQuery;
}

const db = supabaseAdmin as unknown as UntypedDb;
const SOURCE = "five_dollar_football";
const BOOTSTRAP_DAYS = 365;
const RESCAN_DAYS = 3;
const PAGE_SIZE = 100;

interface ApiLeague {
  id: number;
  name: string;
  countryCode: string;
}

interface StoredFixture {
  source: string;
  league_id: number;
  league_key: string;
  league_name: string;
  country_code: string | null;
  fixture_id: number;
  kickoff_at: string;
  home_team_id: number;
  home_team_name: string;
  away_team_id: number;
  away_team_name: string;
  home_goals: number;
  away_goals: number;
}

function record(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Row)
    : null;
}

function numberValue(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function apiData(payload: unknown): unknown[] {
  const root = record(payload);
  return Array.isArray(root?.["data"]) ? root["data"] : [];
}

function hasMore(payload: unknown): boolean {
  const pagination = record(record(payload)?.["pagination"]);
  return pagination?.["has_more"] === true;
}

function normalizedText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function targetLeague(country: string, name: string): boolean {
  const n = normalizedText(name);
  if (/women|femin|feminin|u\d|youth|junior/.test(n)) return false;
  if (country === "GB-ENG") return /england (premier league|championship)$/.test(n) || n === "premier league" || n === "championship";
  if (country === "DE") return /germany bundesliga (i|ii)$/.test(n) || /bundesliga (i|ii)$/.test(n);
  if (country === "ES") return n === "spain la liga" || n === "la liga" || n === "spain segunda";
  if (country === "IT") return /(^|italy )serie [ab]$/.test(n);
  if (country === "FR") return /(^|france )ligue [12]$/.test(n);
  if (country === "BR") return /(^| )(brazil |brasil )?serie [ab]$/.test(n) || /brasileirao serie [ab]$/.test(n);
  if (country === "NL") return n === "netherlands eredivisie" || n === "netherlands eerste divisie";
  if (country === "PT") return n === "portugal primeira liga" || n === "portugal segunda liga";
  if (country === "TR") return n === "turkiye super lig" || n === "turkiye 1 lig";
  if (country === "SK") return n === "slovakia super liga";
  if (country === "NO") return n === "norway eliteserien" || n === "norway division 1";
  if (country === "AR") return n === "argentina liga profesional" || n === "argentina nacional b";
  if (country === "EC") return n === "ecuador ligapro serie a" || n === "ecuador ligapro serie b";
  if (country === "BE") return n === "belgium pro league";
  if (country === "US") return n === "usa major league soccer" || n === "major league soccer" || n === "mls";
  if (country === "SA") return n === "saudi arabia pro league" || n === "saudi pro league";
  return false;
}

function correctedLeagueKey(fixture: FiveDollarFixture): string {
  const raw = externalMatchKey(fixture).split(":")[0] ?? "";
  const tournament = normalizedText(fixture.tournament);
  if (tournament.includes("brazil") || tournament.includes("brasil")) {
    if (/serie a$/.test(tournament)) return "brazil-serie-a";
    if (/serie b$/.test(tournament)) return "brazil-serie-b";
  }
  return raw;
}

function fallbackLeagueKey(league: ApiLeague): string {
  const n = normalizedText(league.name);
  if (league.countryCode === "BR") {
    if (/serie a$/.test(n)) return "brazil-serie-a";
    if (/serie b$/.test(n)) return "brazil-serie-b";
  }
  return normalizeTeamName(`${league.countryCode} ${league.name}`).replace(/\s+/g, "-");
}

async function discoverLeagues(activeSince: number): Promise<ApiLeague[]> {
  const countries = ["GB-ENG", "DE", "ES", "IT", "FR", "BR", "NL", "PT", "BE", "TR", "SK", "NO", "AR", "EC", "US", "SA"];
  const found = new Map<number, ApiLeague>();

  for (const country of countries) {
    let page = 1;
    while (true) {
      const res = await fiveDollarGet(
        `/leagues?country=${encodeURIComponent(country)}&active_since=${activeSince}&page=${page}&per_page=${PAGE_SIZE}`,
      );
      if (res.status !== "OK" || res.payload === null) {
        if (res.status === "RATE_LIMITED") throw new Error(res.errorMessage ?? "Rate limit na descoberta de ligas.");
        break;
      }
      for (const item of apiData(res.payload)) {
        const league = record(item);
        const id = numberValue(league?.["id"]);
        const name = stringValue(league?.["name"]);
        const countryRow = record(league?.["country"]);
        const countryCode = stringValue(countryRow?.["code"]) ?? country;
        if (id !== null && name && targetLeague(countryCode, name)) {
          found.set(id, { id, name, countryCode });
        }
      }
      if (!hasMore(res.payload)) break;
      page += 1;
    }
  }

  return [...found.values()].sort((a, b) => a.countryCode.localeCompare(b.countryCode) || a.name.localeCompare(b.name));
}

async function latestStoredKickoff(leagueId: number): Promise<string | null> {
  const res = await db
    .from("elo_fixtures")
    .select("kickoff_at")
    .eq("source", SOURCE)
    .eq("league_id", leagueId)
    .order("kickoff_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error || !res.data) return null;
  return stringValue((res.data as Row)["kickoff_at"]);
}

function fixtureRow(fixture: FiveDollarFixture, league: ApiLeague, fetchedAt: string): StoredFixture | null {
  if (
    fixture.statusType !== "finished" ||
    !fixture.startTimestamp ||
    fixture.homeTeamId === null ||
    fixture.awayTeamId === null ||
    fixture.homeScore === null ||
    fixture.awayScore === null
  ) {
    return null;
  }
  return {
    source: SOURCE,
    league_id: league.id,
    league_key: correctedLeagueKey(fixture) || fallbackLeagueKey(league),
    league_name: fixture.tournament || league.name,
    country_code: league.countryCode,
    fixture_id: fixture.eventId,
    kickoff_at: new Date(fixture.startTimestamp * 1000).toISOString(),
    home_team_id: fixture.homeTeamId,
    home_team_name: fixture.homeName,
    away_team_id: fixture.awayTeamId,
    away_team_name: fixture.awayName,
    home_goals: fixture.homeScore,
    away_goals: fixture.awayScore,
  };
}

async function fetchLeagueFixtures(league: ApiLeague, nowMs: number): Promise<number> {
  const latest = await latestStoredKickoff(league.id);
  const bootstrapStart = nowMs - BOOTSTRAP_DAYS * 86_400_000;
  const startMs = latest
    ? Math.max(bootstrapStart, Date.parse(latest) - RESCAN_DAYS * 86_400_000)
    : bootstrapStart;
  const start = Math.floor(startMs / 1000);
  const end = Math.floor(nowMs / 1000) + 1;
  let page = 1;
  let fetched = 0;

  while (true) {
    const res = await fiveDollarGet(
      `/leagues/${league.id}/fixtures?status=finished&start_time=${start}&end_time=${end}&page=${page}&per_page=${PAGE_SIZE}`,
    );
    if (res.status !== "OK" || res.payload === null) {
      throw new Error(`${league.name}: ${res.errorMessage ?? res.status}`);
    }
    const rows = parseFixtures(res.payload)
      .map((fixture) => fixtureRow(fixture, league, res.fetchedAt))
      .filter((row): row is StoredFixture => row !== null);
    fetched += rows.length;
    for (let i = 0; i < rows.length; i += 200) {
      const write = await db
        .from("elo_fixtures")
        .upsert(rows.slice(i, i + 200), { onConflict: "source,league_id,fixture_id" });
      if (write.error) throw new Error(`${league.name}: falha ao salvar fixtures Elo: ${write.error.message}`);
    }
    if (!hasMore(res.payload)) break;
    page += 1;
  }
  return fetched;
}

async function storedLeagueFixtures(leagueId: number): Promise<StoredFixture[]> {
  const rows: StoredFixture[] = [];
  let from = 0;
  const size = 750;
  while (true) {
    const res = await db
      .from("elo_fixtures")
      .select("source,league_id,league_key,league_name,country_code,fixture_id,kickoff_at,home_team_id,home_team_name,away_team_id,away_team_name,home_goals,away_goals")
      .eq("source", SOURCE)
      .eq("league_id", leagueId)
      .order("kickoff_at", { ascending: true })
      .range(from, from + size - 1);
    if (res.error) throw new Error(`Falha ao ler ledger Elo: ${res.error.message}`);
    const page = Array.isArray(res.data) ? (res.data as StoredFixture[]) : [];
    rows.push(...page);
    if (page.length < size) break;
    from += size;
  }
  return rows;
}

async function rebuildLeagueElo(league: ApiLeague): Promise<{ fixtures: number; teams: number }> {
  const fixtures = await storedLeagueFixtures(league.id);
  if (fixtures.length === 0) return { fixtures: 0, teams: 0 };

  const delHistory = await db
    .from("elo_fixture_history")
    .delete()
    .eq("model_version", ELO_MODEL_VERSION)
    .eq("league_id", league.id);
  if (delHistory.error) throw new Error(delHistory.error.message);
  const delRatings = await db
    .from("elo_team_ratings")
    .delete()
    .eq("model_version", ELO_MODEL_VERSION)
    .eq("league_id", league.id);
  if (delRatings.error) throw new Error(delRatings.error.message);

  const ratings = new Map<number, number>();
  const names = new Map<number, string>();
  const counts = new Map<number, number>();
  const firstAt = new Map<number, string>();
  const lastAt = new Map<number, string>();
  const history: Row[] = [];
  let priorHomeScoreSum = 0;
  let priorMatches = 0;

  for (const fixture of fixtures) {
    const homeBefore = ratings.get(fixture.home_team_id) ?? ELO_INITIAL_RATING;
    const awayBefore = ratings.get(fixture.away_team_id) ?? ELO_INITIAL_RATING;
    const homeAdvantage = homeAdvantageFromPast(priorHomeScoreSum, priorMatches);
    const updated = updateElo({
      homeRating: homeBefore,
      awayRating: awayBefore,
      homeGoals: fixture.home_goals,
      awayGoals: fixture.away_goals,
      homeAdvantage,
    });

    ratings.set(fixture.home_team_id, updated.homeAfter);
    ratings.set(fixture.away_team_id, updated.awayAfter);
    names.set(fixture.home_team_id, fixture.home_team_name);
    names.set(fixture.away_team_id, fixture.away_team_name);
    counts.set(fixture.home_team_id, (counts.get(fixture.home_team_id) ?? 0) + 1);
    counts.set(fixture.away_team_id, (counts.get(fixture.away_team_id) ?? 0) + 1);
    if (!firstAt.has(fixture.home_team_id)) firstAt.set(fixture.home_team_id, fixture.kickoff_at);
    if (!firstAt.has(fixture.away_team_id)) firstAt.set(fixture.away_team_id, fixture.kickoff_at);
    lastAt.set(fixture.home_team_id, fixture.kickoff_at);
    lastAt.set(fixture.away_team_id, fixture.kickoff_at);

    history.push({
      model_version: ELO_MODEL_VERSION,
      league_id: fixture.league_id,
      league_key: fixture.league_key,
      league_name: fixture.league_name,
      fixture_id: fixture.fixture_id,
      kickoff_at: fixture.kickoff_at,
      home_team_id: fixture.home_team_id,
      home_team_name: fixture.home_team_name,
      away_team_id: fixture.away_team_id,
      away_team_name: fixture.away_team_name,
      home_goals: fixture.home_goals,
      away_goals: fixture.away_goals,
      home_rating_before: homeBefore,
      away_rating_before: awayBefore,
      home_rating_after: updated.homeAfter,
      away_rating_after: updated.awayAfter,
      home_advantage_points: homeAdvantage,
      expected_home_score: updated.expectedHome,
      actual_home_score: updated.actualHome,
      elo_delta: updated.delta,
    });
    priorHomeScoreSum += updated.actualHome;
    priorMatches += 1;
  }

  for (let i = 0; i < history.length; i += 200) {
    const write = await db.from("elo_fixture_history").insert(history.slice(i, i + 200));
    if (write.error) throw new Error(`Falha ao salvar histórico Elo: ${write.error.message}`);
  }

  const latest = fixtures[fixtures.length - 1]!;
  const ratingRows = [...ratings.entries()].map(([teamId, rating]) => ({
    model_version: ELO_MODEL_VERSION,
    league_id: league.id,
    league_key: latest.league_key || fallbackLeagueKey(league),
    league_name: latest.league_name || league.name,
    team_id: teamId,
    team_name: names.get(teamId) ?? String(teamId),
    rating,
    matches_processed: counts.get(teamId) ?? 0,
    first_fixture_at: firstAt.get(teamId) ?? null,
    last_fixture_at: lastAt.get(teamId) ?? null,
    updated_at: new Date().toISOString(),
  }));
  for (let i = 0; i < ratingRows.length; i += 200) {
    const write = await db
      .from("elo_team_ratings")
      .upsert(ratingRows.slice(i, i + 200), { onConflict: "model_version,league_id,team_id" });
    if (write.error) throw new Error(`Falha ao salvar ratings Elo: ${write.error.message}`);
  }

  return { fixtures: fixtures.length, teams: ratings.size };
}

async function updateSyncState(values: Row) {
  const write = await db.from("elo_sync_state").upsert(
    {
      id: "main",
      source: SOURCE,
      model_version: ELO_MODEL_VERSION,
      updated_at: new Date().toISOString(),
      ...values,
    },
    { onConflict: "id" },
  );
  if (write.error) throw new Error(write.error.message);
}

export async function syncEloFromFiveDollar() {
  const startedAt = new Date().toISOString();
  fiveDollarResetUsage();
  await updateSyncState({ last_started_at: startedAt, last_status: "RUNNING", error_message: null });

  try {
    const nowMs = Date.now();
    const activeSince = Math.floor((nowMs - BOOTSTRAP_DAYS * 86_400_000) / 1000);
    const leagues = await discoverLeagues(activeSince);
    if (leagues.length === 0) throw new Error("Nenhuma liga alvo acessível foi encontrada na 5Dollar.");

    let fixturesFetched = 0;
    const leagueDetails: Row[] = [];
    for (const league of leagues) {
      const fetched = await fetchLeagueFixtures(league, nowMs);
      fixturesFetched += fetched;
      const rebuilt = await rebuildLeagueElo(league);
      leagueDetails.push({ ...league, fetched, ...rebuilt });
    }

    const usage = fiveDollarUsage();
    const completedAt = new Date().toISOString();
    await updateSyncState({
      last_completed_at: completedAt,
      last_status: "OK",
      leagues_processed: leagues.length,
      fixtures_fetched: fixturesFetched,
      api_requests: usage.requestsMade,
      error_message: null,
      details: { leagues: leagueDetails, rateLimit: usage.rateLimit },
    });
    return {
      status: "OK" as const,
      startedAt,
      completedAt,
      leagues: leagueDetails,
      fixturesFetched,
      apiRequests: usage.requestsMade,
      rateLimit: usage.rateLimit,
    };
  } catch (error) {
    const usage = fiveDollarUsage();
    const message = error instanceof Error ? error.message : "Falha desconhecida no Elo sync.";
    await updateSyncState({
      last_completed_at: new Date().toISOString(),
      last_status: "ERROR",
      api_requests: usage.requestsMade,
      error_message: message,
      details: { rateLimit: usage.rateLimit },
    });
    throw error;
  }
}
