// Adapter NATIVO da 5DollarFootballAPI (https://api.5dollarfootballapi.com/v1). Server-only.
// Credencial exclusivamente via FIVE_DOLLAR_FOOTBALL_API_KEY (header Authorization: Bearer).

import {
  externalMatchKey,
  isPreMatchFinished,
  parseFixtures,
  resolveFixture,
  teamRelativeStats,
  FIVE_DOLLAR_DEFINITION_VERSION,
  FIVE_DOLLAR_SOURCE,
  type FiveDollarFixture,
  type TeamRelativeStat,
} from "./five_dollar.parse";
import type { CsvMatchQuery, MatchResolution } from "./football.shared";

export { FIVE_DOLLAR_DEFINITION_VERSION, FIVE_DOLLAR_SOURCE };

const BASE = "https://api.5dollarfootballapi.com/v1";
const TIMEOUT_MS = 15000;
// Operational guard stays one request below the documented Pro 10/minute cap.
const MAX_PER_MINUTE = 9;
const CACHE_TTL_MS = 15 * 60 * 1000;
const STATUS_CACHE_TTL_MS = 10 * 60 * 1000;
const PAGE_SIZE = 100;
const EXPANDED_PAGE_SIZE = 50;
const PROVIDER = "five_dollar";

export type FiveDollarStatus = "OK" | "UNAVAILABLE" | "NOT_CONFIGURED" | "RATE_LIMITED";

export interface FiveDollarFetch<T = unknown> {
  status: FiveDollarStatus;
  endpoint: string;
  path: string;
  payload: T | null;
  httpStatus: number | null;
  errorMessage: string | null;
  fetchedAt: string;
  fromCache: boolean;
  rateLimit: { limit: number | null; remaining: number | null; reset: number | null };
}

interface CacheEntry {
  payload: unknown;
  httpStatus: number | null;
  fetchedAt: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const callTimestamps: number[] = [];
let rateBlockedUntil = 0;
let lastHeaders: { limit: number | null; remaining: number | null; reset: number | null } = {
  limit: null,
  remaining: null,
  reset: null,
};
let requestsMade = 0;
let cacheHits = 0;
let distributedCacheHits = 0;
let rateLimitHits = 0;
const endpointsCalled: string[] = [];

export function fiveDollarUsage() {
  return {
    requestsMade,
    cacheHits,
    distributedCacheHits,
    rateLimitHits,
    rateLimit: { ...lastHeaders },
    endpointsCalled: [...endpointsCalled],
    blocked: Date.now() < rateBlockedUntil,
    distributedRateLimit: true,
  };
}

export function fiveDollarResetUsage() {
  requestsMade = 0;
  cacheHits = 0;
  distributedCacheHits = 0;
  rateLimitHits = 0;
  endpointsCalled.length = 0;
}

function apiKey(): string | null {
  const key = process.env["FIVE_DOLLAR_FOOTBALL_API_KEY"];
  return key && key.trim() ? key.trim() : null;
}

export function fiveDollarConfigured(): boolean {
  return apiKey() !== null;
}

async function serviceDb(): Promise<any | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return supabaseAdmin as any;
  } catch {
    return null;
  }
}

async function readDistributedCache<T>(endpoint: string): Promise<CacheEntry | null> {
  const db = await serviceDb();
  if (!db) return null;
  try {
    const { data, error } = await db
      .from("external_api_cache")
      .select("payload,http_status,fetched_at,expires_at")
      .eq("provider", PROVIDER)
      .eq("cache_key", endpoint)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error || !data) return null;
    return {
      payload: data.payload as T,
      httpStatus: data.http_status,
      fetchedAt: data.fetched_at,
      expiresAt: Date.parse(data.expires_at),
    };
  } catch {
    return null;
  }
}

async function writeDistributedCache(endpoint: string, payload: unknown, httpStatus: number, fetchedAt: string, ttlMs: number) {
  const db = await serviceDb();
  if (!db) return;
  try {
    await db.from("external_api_cache").upsert({
      provider: PROVIDER,
      cache_key: endpoint,
      payload,
      http_status: httpStatus,
      fetched_at: fetchedAt,
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
    }, { onConflict: "provider,cache_key" });
  } catch {
    // Cache failure must never turn an upstream success into an application failure.
  }
}

async function acquireDistributedSlot(): Promise<{ allowed: boolean; resetAt: number } | null> {
  const db = await serviceDb();
  if (!db) return null;
  try {
    const { data, error } = await db.rpc("acquire_external_api_slot", {
      p_provider: PROVIDER,
      p_limit: MAX_PER_MINUTE,
      p_window_seconds: 60,
    });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return { allowed: Boolean(row.allowed), resetAt: Date.parse(String(row.reset_at)) };
  } catch {
    return null;
  }
}

async function markDistributedRateLimit(retryAfterSeconds: number) {
  const db = await serviceDb();
  if (!db) return;
  try {
    await db.rpc("mark_external_api_rate_limited", {
      p_provider: PROVIDER,
      p_retry_after_seconds: Math.max(1, Math.ceil(retryAfterSeconds)),
    });
  } catch {
    // Local Retry-After guard remains as a fallback.
  }
}

async function localThrottle(): Promise<void> {
  const now = Date.now();
  while (callTimestamps.length > 0 && now - callTimestamps[0]! > 60_000) callTimestamps.shift();
  if (callTimestamps.length >= MAX_PER_MINUTE) {
    const wait = 60_000 - (now - callTimestamps[0]!) + 350;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, wait)));
    const after = Date.now();
    while (callTimestamps.length > 0 && after - callTimestamps[0]! > 60_000) callTimestamps.shift();
  }
  callTimestamps.push(Date.now());
}

async function globalThrottle(): Promise<void> {
  // The database is the cross-instance source of truth. If it is temporarily
  // unavailable, the previous per-process limiter remains a safe fallback.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slot = await acquireDistributedSlot();
    if (slot === null) {
      await localThrottle();
      return;
    }
    if (slot.allowed) return;
    const wait = Math.max(250, Math.min(61_000, slot.resetAt - Date.now() + 250));
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  await localThrottle();
}

function readRateHeaders(res: Response) {
  const n = (v: string | null) => (v !== null && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  lastHeaders = {
    limit: n(res.headers.get("x-ratelimit-limit")),
    remaining: n(res.headers.get("x-ratelimit-remaining")),
    reset: n(res.headers.get("x-ratelimit-reset")),
  };
}

export async function fiveDollarGet<T = unknown>(
  path: string,
  options?: { cacheTtlMs?: number; bypassCache?: boolean },
): Promise<FiveDollarFetch<T>> {
  const endpoint = `${BASE}${path}`;
  const now = () => new Date().toISOString();
  const key = apiKey();
  const ttlMs = options?.cacheTtlMs ?? CACHE_TTL_MS;
  const base = { endpoint, path, payload: null, fromCache: false, rateLimit: { ...lastHeaders } };

  if (!key) {
    return { ...base, status: "NOT_CONFIGURED", httpStatus: null, errorMessage: "FIVE_DOLLAR_FOOTBALL_API_KEY ausente no servidor.", fetchedAt: now() };
  }

  if (!options?.bypassCache) {
    const local = cache.get(endpoint);
    if (local && local.expiresAt > Date.now()) {
      cacheHits += 1;
      return { ...base, status: "OK", payload: local.payload as T, httpStatus: local.httpStatus, errorMessage: null, fetchedAt: local.fetchedAt, fromCache: true };
    }
    const distributed = await readDistributedCache<T>(endpoint);
    if (distributed && distributed.expiresAt > Date.now()) {
      cacheHits += 1;
      distributedCacheHits += 1;
      cache.set(endpoint, distributed);
      return { ...base, status: "OK", payload: distributed.payload as T, httpStatus: distributed.httpStatus, errorMessage: null, fetchedAt: distributed.fetchedAt, fromCache: true };
    }
  }

  if (Date.now() < rateBlockedUntil) {
    return { ...base, status: "RATE_LIMITED", httpStatus: 429, errorMessage: `Rate limit ativo até ${new Date(rateBlockedUntil).toISOString()}; nenhuma nova chamada disparada.`, fetchedAt: now() };
  }

  await globalThrottle();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
    });
    requestsMade += 1;
    endpointsCalled.push(path);
    readRateHeaders(res);

    if (res.status === 429) {
      rateLimitHits += 1;
      const retryAfter = Number(res.headers.get("retry-after") ?? "60");
      const safeRetry = Number.isFinite(retryAfter) ? retryAfter : 60;
      rateBlockedUntil = Date.now() + safeRetry * 1000;
      await markDistributedRateLimit(safeRetry);
      return { ...base, status: "RATE_LIMITED", httpStatus: 429, errorMessage: `HTTP 429 na fonte; aguardando ${safeRetry}s conforme Retry-After. Etapa encerrada em estado parcial.`, fetchedAt: now(), rateLimit: { ...lastHeaders } };
    }

    if (!res.ok) {
      return { ...base, status: "UNAVAILABLE", httpStatus: res.status, errorMessage: `HTTP ${res.status} em ${path}.`, fetchedAt: now(), rateLimit: { ...lastHeaders } };
    }

    const payload = (await res.json()) as T;
    const envelope = payload as { success?: unknown; error?: { message?: string; code?: string } };
    if (envelope?.success === 0 || envelope?.error) {
      return { ...base, status: "UNAVAILABLE", httpStatus: res.status, errorMessage: `Erro reportado pela fonte em ${path}: ${envelope?.error?.message ?? "sem detalhe"}`, fetchedAt: now(), rateLimit: { ...lastHeaders } };
    }

    const fetchedAt = now();
    const entry = { payload, httpStatus: res.status, fetchedAt, expiresAt: Date.now() + ttlMs };
    cache.set(endpoint, entry);
    await writeDistributedCache(endpoint, payload, res.status, fetchedAt, ttlMs);
    return { ...base, status: "OK", payload, httpStatus: res.status, errorMessage: null, fetchedAt, rateLimit: { ...lastHeaders } };
  } catch (error) {
    return {
      ...base,
      status: "UNAVAILABLE",
      httpStatus: null,
      errorMessage: error instanceof Error && error.name === "AbortError"
        ? `Timeout de ${TIMEOUT_MS} ms em ${path}.`
        : error instanceof Error ? error.message : "Falha de rede desconhecida.",
      fetchedAt: now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function fiveDollarApiStatus() {
  const fetched = await fiveDollarGet<unknown>("/status", { cacheTtlMs: STATUS_CACHE_TTL_MS });
  if (fetched.status !== "OK" || fetched.payload === null) return { fetched, plan: null, limit: null };
  const root = record(fetched.payload);
  const data = record(root?.["data"]) ?? root;
  const plan = typeof data?.["plan"] === "string" ? String(data["plan"]) : null;
  const limitRaw = data?.["rate_limit"] ?? data?.["limit"] ?? lastHeaders.limit;
  const limit = Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : null;
  const db = await serviceDb();
  if (db) {
    try {
      await db.from("external_api_status_snapshots").upsert({
        provider: PROVIDER,
        plan,
        reported_limit: limit,
        payload: fetched.payload,
        checked_at: fetched.fetchedAt,
      }, { onConflict: "provider" });
    } catch {
      // Operational status persistence is best-effort.
    }
  }
  return { fetched, plan, limit };
}

function hasMore(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const pagination = (payload as { pagination?: unknown }).pagination;
  return Boolean(
    typeof pagination === "object" &&
      pagination !== null &&
      (pagination as { has_more?: unknown }).has_more === true,
  );
}

async function paginatedFixtures(
  basePath: string,
  pageSize = PAGE_SIZE,
): Promise<{ fixtures: FiveDollarFixture[]; fetches: FiveDollarFetch[] }> {
  const fetches: FiveDollarFetch[] = [];
  const byId = new Map<number, FiveDollarFixture>();
  for (let page = 1; page <= 50; page += 1) {
    const join = basePath.includes("?") ? "&" : "?";
    const res = await fiveDollarGet(`${basePath}${join}page=${page}&per_page=${pageSize}`);
    fetches.push(res);
    if (res.status !== "OK" || res.payload === null) break;
    for (const fixture of parseFixtures(res.payload)) byId.set(fixture.eventId, fixture);
    if (!hasMore(res.payload)) break;
  }
  return { fixtures: [...byId.values()], fetches };
}

export interface FiveDollarResolution {
  resolution: MatchResolution | null;
  fetch: FiveDollarFetch;
  fetches: FiveDollarFetch[];
  events: FiveDollarFixture[];
}

export async function fiveDollarResolveMatch(
  query: CsvMatchQuery,
  isoDate: string,
): Promise<FiveDollarResolution> {
  const start = Math.floor(Date.parse(`${isoDate}T03:00:00Z`) / 1000);
  const end = start + 24 * 3600;
  const { fixtures, fetches } = await paginatedFixtures(
    `/fixtures?start_time=${start}&end_time=${end}&include=odds`,
    EXPANDED_PAGE_SIZE,
  );
  const fetch = fetches[0] ?? {
    status: "UNAVAILABLE" as const,
    endpoint: `${BASE}/fixtures`,
    path: "/fixtures",
    payload: null,
    httpStatus: null,
    errorMessage: "Nenhuma página retornada pela fonte.",
    fetchedAt: new Date().toISOString(),
    fromCache: false,
    rateLimit: { ...lastHeaders },
  };
  if (fetches.some((f) => f.status !== "OK")) {
    return { resolution: null, fetch, fetches, events: fixtures };
  }
  return { resolution: resolveFixture(query, fixtures), fetch, fetches, events: fixtures };
}

export interface FiveDollarRawObservation {
  observation: TeamRelativeStat;
  endpoint: string;
  fetchedAt: string;
  observedAt: string | null;
  fixtureId: number;
  externalMatchId: string;
  fixtureDate: string;
  teamId: number;
  opponentId: number | null;
  teamSide: "HOME" | "AWAY";
  rawHomeAway: {
    goalsHome: number | null;
    goalsAway: number | null;
    cornersHome: number | null;
    cornersAway: number | null;
  };
}

export interface FiveDollarHistory {
  observations: FiveDollarRawObservation[];
  fetches: FiveDollarFetch[];
  eventsConsidered: number;
  insufficientHistory: boolean;
  fixtures: FiveDollarFixture[];
}

function observationsForFixtures(fixtures: FiveDollarFixture[], teamIds: number[], predictionAtIso: string, endpoint: string, fetchedAt: string) {
  const allowed = new Set(teamIds);
  const observations: FiveDollarRawObservation[] = [];
  for (const fixture of fixtures) {
    for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
      if (teamId === null || !allowed.has(teamId)) continue;
      const relative = teamRelativeStats(fixture, teamId, predictionAtIso);
      if (!relative) continue;
      const observedAt = fixture.startTimestamp ? new Date(fixture.startTimestamp * 1000).toISOString() : null;
      const externalMatchId = externalMatchKey(fixture);
      const fixtureDate = observedAt ? observedAt.slice(0, 10) : "";
      for (const observation of relative.stats) {
        observations.push({
          observation,
          endpoint,
          fetchedAt,
          observedAt,
          fixtureId: fixture.eventId,
          externalMatchId,
          fixtureDate,
          teamId,
          opponentId: relative.opponentId,
          teamSide: relative.side,
          rawHomeAway: relative.raw,
        });
      }
    }
  }
  return observations;
}

export async function fiveDollarLeagueHistory(
  leagueId: number,
  teamIds: number[],
  predictionAtIso: string,
  lookbackDays = 365,
): Promise<FiveDollarHistory> {
  const cutoffMs = Date.parse(predictionAtIso) - 1;
  const start = Math.floor((cutoffMs - lookbackDays * 86400_000) / 1000);
  const end = Math.floor(cutoffMs / 1000);
  // Pro supports compound includes. These richer fields are persisted as
  // research-only observations; contractCompatible=false keeps them out of
  // model pricing until explicit walk-forward approval.
  const { fixtures: rawFixtures, fetches } = await paginatedFixtures(
    `/leagues/${leagueId}/fixtures?status=finished&start_time=${start}&end_time=${end}&include=events,stats`,
  );
  const fixtures = rawFixtures
    .filter((f) => isPreMatchFinished(f, predictionAtIso))
    .sort((a, b) => (a.startTimestamp ?? 0) - (b.startTimestamp ?? 0));
  const endpoint = fetches[0]?.endpoint ?? `${BASE}/leagues/${leagueId}/fixtures`;
  const fetchedAt = fetches[0]?.fetchedAt ?? new Date().toISOString();
  const observations = observationsForFixtures(fixtures, teamIds, predictionAtIso, endpoint, fetchedAt);
  return {
    observations,
    fetches,
    eventsConsidered: fixtures.length,
    insufficientHistory: fixtures.length < 3,
    fixtures,
  };
}

export async function fiveDollarTeamHistory(
  teamId: number,
  predictionAtIso: string,
  maxEvents = 20,
): Promise<FiveDollarHistory> {
  const fetches: FiveDollarFetch[] = [];
  const observations: FiveDollarRawObservation[] = [];
  const cutoff = Math.floor(Date.parse(predictionAtIso) / 1000) - 1;
  const perPage = Math.min(Math.max(maxEvents, 1), EXPANDED_PAGE_SIZE);

  const res = await fiveDollarGet(
    `/teams/${teamId}/fixtures?status=finished&end_time=${cutoff}&include=events,stats&page=1&per_page=${perPage}`,
  );
  fetches.push(res);
  if (res.status !== "OK" || res.payload === null) {
    return { observations, fetches, eventsConsidered: 0, insufficientHistory: true, fixtures: [] };
  }

  const fixtures = parseFixtures(res.payload)
    .filter((f) => isPreMatchFinished(f, predictionAtIso))
    .sort((a, b) => (b.startTimestamp ?? 0) - (a.startTimestamp ?? 0))
    .slice(0, maxEvents);

  for (const fixture of fixtures) {
    const relative = teamRelativeStats(fixture, teamId, predictionAtIso);
    if (!relative) continue;
    const observedAt = fixture.startTimestamp ? new Date(fixture.startTimestamp * 1000).toISOString() : null;
    const externalMatchId = externalMatchKey(fixture);
    const fixtureDate = observedAt ? observedAt.slice(0, 10) : "";
    for (const observation of relative.stats) {
      observations.push({
        observation,
        endpoint: res.endpoint,
        fetchedAt: res.fetchedAt,
        observedAt,
        fixtureId: fixture.eventId,
        externalMatchId,
        fixtureDate,
        teamId,
        opponentId: relative.opponentId,
        teamSide: relative.side,
        rawHomeAway: relative.raw,
      });
    }
  }

  return {
    observations,
    fetches,
    eventsConsidered: fixtures.length,
    insufficientHistory: fixtures.length < Math.min(maxEvents, 3),
    fixtures,
  };
}
