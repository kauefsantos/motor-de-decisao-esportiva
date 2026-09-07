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
const MAX_PER_MINUTE = 18;
const MAX_PER_HOUR = 300;
const CACHE_TTL_MS = 15 * 60 * 1000;

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
let rateLimitHits = 0;
const endpointsCalled: string[] = [];

export function fiveDollarUsage() {
  return {
    requestsMade,
    cacheHits,
    rateLimitHits,
    rateLimit: { ...lastHeaders },
    endpointsCalled: [...endpointsCalled],
    blocked: Date.now() < rateBlockedUntil,
  };
}

export function fiveDollarResetUsage() {
  requestsMade = 0;
  cacheHits = 0;
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

async function throttle(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const now = Date.now();
  while (callTimestamps.length > 0 && now - callTimestamps[0]! > 3600_000) callTimestamps.shift();
  if (callTimestamps.length >= MAX_PER_HOUR) {
    return { ok: false, reason: "Cota horária local (300 req/h) atingida; etapa encerrada em estado parcial." };
  }
  const lastMinute = callTimestamps.filter((t) => now - t < 60_000);
  if (lastMinute.length >= MAX_PER_MINUTE) {
    const wait = 60_000 - (now - lastMinute[0]!) + 250;
    await new Promise((r) => setTimeout(r, wait));
  }
  callTimestamps.push(Date.now());
  return { ok: true };
}

function readRateHeaders(res: Response) {
  const n = (v: string | null) => (v !== null && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  lastHeaders = {
    limit: n(res.headers.get("x-ratelimit-limit")),
    remaining: n(res.headers.get("x-ratelimit-remaining")),
    reset: n(res.headers.get("x-ratelimit-reset")),
  };
}

export async function fiveDollarGet<T = unknown>(path: string): Promise<FiveDollarFetch<T>> {
  const endpoint = `${BASE}${path}`;
  const now = () => new Date().toISOString();
  const key = apiKey();
  const base = { endpoint, path, payload: null, fromCache: false, rateLimit: { ...lastHeaders } };

  if (!key) {
    return { ...base, status: "NOT_CONFIGURED", httpStatus: null, errorMessage: "FIVE_DOLLAR_FOOTBALL_API_KEY ausente no servidor.", fetchedAt: now() };
  }

  const cached = cache.get(endpoint);
  if (cached && cached.expiresAt > Date.now()) {
    cacheHits += 1;
    return { ...base, status: "OK", payload: cached.payload as T, httpStatus: cached.httpStatus, errorMessage: null, fetchedAt: cached.fetchedAt, fromCache: true };
  }

  if (Date.now() < rateBlockedUntil) {
    return { ...base, status: "RATE_LIMITED", httpStatus: 429, errorMessage: `Rate limit ativo até ${new Date(rateBlockedUntil).toISOString()}; nenhuma nova chamada disparada.`, fetchedAt: now() };
  }

  const slot = await throttle();
  if (!slot.ok) {
    return { ...base, status: "RATE_LIMITED", httpStatus: null, errorMessage: slot.reason, fetchedAt: now() };
  }

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
      rateBlockedUntil = Date.now() + (Number.isFinite(retryAfter) ? retryAfter : 60) * 1000;
      return { ...base, status: "RATE_LIMITED", httpStatus: 429, errorMessage: `HTTP 429 na fonte; aguardando ${retryAfter}s conforme Retry-After. Etapa encerrada em estado parcial.`, fetchedAt: now(), rateLimit: { ...lastHeaders } };
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
    cache.set(endpoint, { payload, httpStatus: res.status, fetchedAt, expiresAt: Date.now() + CACHE_TTL_MS });
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

export interface FiveDollarResolution {
  resolution: MatchResolution | null;
  fetch: FiveDollarFetch;
  events: FiveDollarFixture[];
}

export async function fiveDollarResolveMatch(
  query: CsvMatchQuery,
  isoDate: string,
): Promise<FiveDollarResolution> {
  const start = Math.floor(Date.parse(`${isoDate}T03:00:00Z`) / 1000);
  const end = start + 24 * 3600;
  const res = await fiveDollarGet(`/fixtures?start_time=${start}&end_time=${end}`);
  if (res.status !== "OK" || res.payload === null) {
    return { resolution: null, fetch: res, events: [] };
  }
  const events = parseFixtures(res.payload);
  return { resolution: resolveFixture(query, events), fetch: res, events };
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

export async function fiveDollarTeamHistory(
  teamId: number,
  predictionAtIso: string,
  maxEvents = 5,
): Promise<FiveDollarHistory> {
  const fetches: FiveDollarFetch[] = [];
  const observations: FiveDollarRawObservation[] = [];
  const cutoff = Math.floor(Date.parse(predictionAtIso) / 1000) - 1;
  const perPage = Math.max(maxEvents, 1);

  const res = await fiveDollarGet(`/teams/${teamId}/fixtures?status=finished&end_time=${cutoff}&page=1&per_page=${perPage}`);
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
    insufficientHistory: fixtures.length < maxEvents,
    fixtures,
  };
}
