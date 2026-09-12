// Adapter API-Football / API-Sports v3. Server-only.
// Um único provedor, sem compatibilidade cruzada com a 5Dollar.

import {
  parseFixtures,
  resolveFixture,
  mapFixtureStatistics,
  goalsFromFixture,
  type ProviderEvent,
} from "./api_football.parse";
import type { CsvMatchQuery, MatchResolution, NormalizedStat } from "./football.shared";
import { isTransientHttpStatus, retryDelayMs } from "../http-retry";

export const API_FOOTBALL_DEFINITION_VERSION = "api_football-v1";
export const API_FOOTBALL_SOURCE = "api_football";

const BASE = "https://v3.football.api-sports.io";
const TIMEOUT_MS = 10000;
const MAX_ATTEMPTS = 3;
const MIN_INTERVAL_MS = 1200;
const CACHE_TTL_MS = 10 * 60 * 1000;

export type ApiFootballFetchStatus = "OK" | "UNAVAILABLE" | "NOT_CONFIGURED";

export interface ApiFootballFetch<T = unknown> {
  status: ApiFootballFetchStatus;
  endpoint: string;
  path: string;
  payload: T | null;
  httpStatus: number | null;
  errorMessage: string | null;
  fetchedAt: string;
  fromCache: boolean;
}

interface CacheEntry {
  payload: unknown;
  httpStatus: number | null;
  fetchedAt: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
let lastCallAt = 0;
const PROVIDER = "api_football";
const DISTRIBUTED_LIMIT_PER_MINUTE = Math.max(1, Math.floor(60_000 / MIN_INTERVAL_MS));

export function apiFootballSource(): string {
  return API_FOOTBALL_SOURCE;
}

export function apiFootballDefinitionVersion(): string {
  return API_FOOTBALL_DEFINITION_VERSION;
}

function baseUrl(): string {
  return process.env["API_FOOTBALL_BASE"]?.replace(/\/$/, "") || BASE;
}

function apiKey(): string | null {
  const key = process.env["API_FOOTBALL_KEY"];
  return key && key.trim() ? key.trim() : null;
}

export function apiFootballConfigured(): boolean {
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
    const { data, error } = await db.from("external_api_cache")
      .select("payload,http_status,fetched_at,expires_at")
      .eq("provider", PROVIDER).eq("cache_key", endpoint)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error || !data) return null;
    return { payload: data.payload as T, httpStatus: data.http_status, fetchedAt: data.fetched_at, expiresAt: Date.parse(data.expires_at) };
  } catch {
    return null;
  }
}

async function writeDistributedCache(endpoint: string, payload: unknown, httpStatus: number, fetchedAt: string) {
  const db = await serviceDb();
  if (!db) return;
  try {
    await db.from("external_api_cache").upsert({
      provider: PROVIDER, cache_key: endpoint, payload, http_status: httpStatus,
      fetched_at: fetchedAt, expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
    }, { onConflict: "provider,cache_key" });
  } catch {
    // Local cache remains the availability fallback.
  }
}

async function throttle() {
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

async function acquireDistributedSlot() {
  const db = await serviceDb();
  if (!db) return null;
  try {
    const { data, error } = await db.rpc("acquire_external_api_slot", {
      p_provider: PROVIDER,
      p_limit: DISTRIBUTED_LIMIT_PER_MINUTE,
      p_window_seconds: 60,
    });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? { allowed: Boolean(row.allowed), resetAt: Date.parse(String(row.reset_at)) } : null;
  } catch {
    return null;
  }
}

async function globalThrottle() {
  // Keep the historic 1.2s per-process spacing and add a shared 50/min ceiling.
  await throttle();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slot = await acquireDistributedSlot();
    if (slot === null) return;
    if (slot.allowed) return;
    const wait = Math.max(250, Math.min(61_000, slot.resetAt - Date.now() + 250));
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

async function markDistributedRateLimit(seconds: number) {
  const db = await serviceDb();
  if (!db) return;
  try {
    await db.rpc("mark_external_api_rate_limited", {
      p_provider: PROVIDER,
      p_retry_after_seconds: Math.max(1, Math.ceil(seconds)),
    });
  } catch {
    // Best effort; local request pacing still applies.
  }
}

export async function apiFootballGet<T = unknown>(path: string): Promise<ApiFootballFetch<T>> {
  const endpoint = `${baseUrl()}${path}`;
  const key = apiKey();
  const now = () => new Date().toISOString();

  if (!key) {
    return { status: "NOT_CONFIGURED", endpoint, path, payload: null, httpStatus: null, errorMessage: "API_FOOTBALL_KEY ausente no servidor.", fetchedAt: now(), fromCache: false };
  }

  const cached = cache.get(endpoint);
  if (cached && cached.expiresAt > Date.now()) {
    return { status: "OK", endpoint, path, payload: cached.payload as T, httpStatus: cached.httpStatus, errorMessage: null, fetchedAt: cached.fetchedAt, fromCache: true };
  }
  const distributed = await readDistributedCache<T>(endpoint);
  if (distributed && distributed.expiresAt > Date.now()) {
    cache.set(endpoint, distributed);
    return { status: "OK", endpoint, path, payload: distributed.payload as T, httpStatus: distributed.httpStatus, errorMessage: null, fetchedAt: distributed.fetchedAt, fromCache: true };
  }

  let lastError = "Falha desconhecida";
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await globalThrottle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, { method: "GET", signal: controller.signal, headers: { Accept: "application/json", "x-apisports-key": key } });
      lastStatus = res.status;

      if (res.status === 401 || res.status === 403) {
        return { status: "UNAVAILABLE", endpoint, path, payload: null, httpStatus: res.status, errorMessage: `Credencial rejeitada pela API-Football (HTTP ${res.status}).`, fetchedAt: now(), fromCache: false };
      }
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "60");
        const safeRetry = Number.isFinite(retryAfter) ? retryAfter : 60;
        await markDistributedRateLimit(safeRetry);
        return { status: "UNAVAILABLE", endpoint, path, payload: null, httpStatus: 429, errorMessage: `Rate limit / cota da API-Football (HTTP 429); bloqueio compartilhado por ${safeRetry}s.`, fetchedAt: now(), fromCache: false };
      }
      if (!res.ok) {
        lastError = `HTTP ${res.status} ao consultar ${path}.`;
        if (isTransientHttpStatus(res.status) && attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
          continue;
        }
        return { status: "UNAVAILABLE", endpoint, path, payload: null, httpStatus: res.status, errorMessage: lastError, fetchedAt: now(), fromCache: false };
      }

      const payload = (await res.json()) as T;
      const errors = (payload as { errors?: unknown })?.errors;
      const errorList = errors && typeof errors === "object" ? Object.values(errors as object).filter(Boolean) : [];
      if (errorList.length > 0) {
        return { status: "UNAVAILABLE", endpoint, path, payload: null, httpStatus: res.status, errorMessage: `Erro reportado pela API-Football: ${errorList.join(" | ")}`, fetchedAt: now(), fromCache: false };
      }
      const fetchedAt = now();
      const entry = { payload, httpStatus: res.status, fetchedAt, expiresAt: Date.now() + CACHE_TTL_MS };
      cache.set(endpoint, entry);
      await writeDistributedCache(endpoint, payload, res.status, fetchedAt);
      return { status: "OK", endpoint, path, payload, httpStatus: res.status, errorMessage: null, fetchedAt, fromCache: false };
    } catch (error) {
      lastError = error instanceof Error && error.name === "AbortError"
        ? `Timeout de ${TIMEOUT_MS} ms em ${path}.`
        : error instanceof Error ? error.message : "Falha de rede desconhecida.";
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return { status: "UNAVAILABLE", endpoint, path, payload: null, httpStatus: lastStatus, errorMessage: lastError, fetchedAt: now(), fromCache: false };
}

export interface ApiFootballResolution {
  resolution: MatchResolution | null;
  fetch: ApiFootballFetch;
  events: ProviderEvent[];
}

export async function apiFootballResolveMatch(
  query: CsvMatchQuery,
  isoDate: string,
): Promise<ApiFootballResolution> {
  const res = await apiFootballGet(`/fixtures?date=${isoDate}`);
  if (res.status !== "OK" || res.payload === null) {
    return { resolution: null, fetch: res, events: [] };
  }
  const events = parseFixtures(res.payload);
  return { resolution: resolveFixture(query, events), fetch: res, events };
}

export interface ApiFootballRawObservation {
  observation: NormalizedStat;
  endpoint: string;
  fetchedAt: string;
  observedAt: string | null;
  fixtureId: number;
}

export interface ApiFootballHistory {
  observations: ApiFootballRawObservation[];
  fetches: ApiFootballFetch[];
  eventsConsidered: number;
  rawStatsReceived: number;
}

export async function apiFootballTeamHistory(
  teamId: number,
  predictionAtIso: string,
  maxEvents = 5,
): Promise<ApiFootballHistory> {
  const fetches: ApiFootballFetch[] = [];
  const observations: ApiFootballRawObservation[] = [];
  let rawStatsReceived = 0;

  const last = await apiFootballGet(`/fixtures?team=${teamId}&last=${Math.max(maxEvents, 5)}`);
  fetches.push(last);
  if (last.status !== "OK" || last.payload === null) {
    return { observations, fetches, eventsConsidered: 0, rawStatsReceived };
  }

  const events = parseFixtures(last.payload)
    .filter((e) => e.statusType === "finished" && e.startTimestamp !== null && e.startTimestamp * 1000 < Date.parse(predictionAtIso))
    .sort((a, b) => (b.startTimestamp ?? 0) - (a.startTimestamp ?? 0))
    .slice(0, maxEvents);

  for (const event of events) {
    const observedAt = event.startTimestamp ? new Date(event.startTimestamp * 1000).toISOString() : null;

    for (const goal of goalsFromFixture(event, predictionAtIso)) {
      observations.push({
        observation: goal,
        endpoint: last.endpoint,
        fetchedAt: last.fetchedAt,
        observedAt,
        fixtureId: event.eventId,
      });
    }

    const stats = await apiFootballGet(`/fixtures/statistics?fixture=${event.eventId}`);
    fetches.push(stats);
    if (stats.status === "OK" && stats.payload !== null) {
      const mapped = mapFixtureStatistics(stats.payload, event.homeTeamId, event.awayTeamId);
      rawStatsReceived += mapped.length;
      for (const stat of mapped) {
        observations.push({
          observation: stat,
          endpoint: stats.endpoint,
          fetchedAt: stats.fetchedAt,
          observedAt,
          fixtureId: event.eventId,
        });
      }
    }
  }

  return { observations, fetches, eventsConsidered: events.length, rawStatsReceived };
}
