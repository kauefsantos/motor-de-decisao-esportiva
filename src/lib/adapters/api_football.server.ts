// Adapter API-Football (API-Sports v3). Server-only.
// Credencial exclusivamente via variável de ambiente do servidor (API_FOOTBALL_KEY).
// Mesmo contrato do adapter anterior: fetch estruturado, timeout, retry limitado,
// rate limiting conservador, cache de payload bruto e nenhum dado fabricado.

import {
  parseFixtures,
  resolveFixture,
  mapFixtureStatistics,
  goalsFromFixture,
  type ProviderEvent,
} from "./api_football.parse";
import type { CsvMatchQuery, MatchResolution, NormalizedStat } from "./sofascore.parse";

export const API_FOOTBALL_DEFINITION_VERSION = "api_football-v1";
export const API_FOOTBALL_SOURCE = "api_football";

// Provider server-side. O contrato HTTP é o mesmo (API-Football v3);
// muda apenas host, credencial e a identidade da fonte no lineage.
export type FootballApiProvider = "api_sports" | "five_dollar";

const PROVIDERS = {
  api_sports: {
    base: "https://v3.football.api-sports.io",
    envKey: "API_FOOTBALL_KEY",
    source: API_FOOTBALL_SOURCE,
    definitionVersion: API_FOOTBALL_DEFINITION_VERSION,
  },
  five_dollar: {
    base: "https://api-football.5dollarfootballapi.com",
    envKey: "FIVE_DOLLAR_FOOTBALL_API_KEY",
    source: "five_dollar_football",
    definitionVersion: "five-dollar-v1",
  },
} as const satisfies Record<
  FootballApiProvider,
  { base: string; envKey: string; source: string; definitionVersion: string }
>;

const TIMEOUT_MS = 10000;
const MAX_ATTEMPTS = 3;
const MIN_INTERVAL_MS = 1200;
const CACHE_TTL_MS = 10 * 60 * 1000;


export type ApiFootballFetchStatus = "OK" | "UNAVAILABLE" | "NOT_CONFIGURED";

export interface ApiFootballFetch<T = unknown> {
  status: ApiFootballFetchStatus;
  /** endpoint completo consultado (sem credencial) */
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

/** Provider ativo: explícito via FOOTBALL_API_PROVIDER, senão o que tiver credencial. */
export function apiFootballProvider(): FootballApiProvider {
  const explicit = process.env["FOOTBALL_API_PROVIDER"]?.trim();
  if (explicit === "five_dollar" || explicit === "api_sports") return explicit;
  const fiveDollar = process.env[PROVIDERS.five_dollar.envKey];
  const apiSports = process.env[PROVIDERS.api_sports.envKey];
  if (!apiSports?.trim() && fiveDollar?.trim()) return "five_dollar";
  return "api_sports";
}

/** Identidade da fonte no lineage (nunca misturar IDs externos entre providers). */
export function apiFootballSource(): string {
  return PROVIDERS[apiFootballProvider()].source;
}

export function apiFootballDefinitionVersion(): string {
  return PROVIDERS[apiFootballProvider()].definitionVersion;
}

function baseUrl(): string {
  const provider = apiFootballProvider();
  const override =
    provider === "api_sports" ? process.env["API_FOOTBALL_BASE"] : process.env["FIVE_DOLLAR_FOOTBALL_BASE"];
  return override?.replace(/\/$/, "") || PROVIDERS[provider].base;
}

function apiKey(): string | null {
  const key = process.env[PROVIDERS[apiFootballProvider()].envKey];
  return key && key.trim() ? key.trim() : null;
}

export function apiFootballConfigured(): boolean {
  return apiKey() !== null;
}

async function throttle() {
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

/** GET autorizado com timeout, retry limitado e backoff. Nunca simula resposta. */
export async function apiFootballGet<T = unknown>(path: string): Promise<ApiFootballFetch<T>> {
  const endpoint = `${baseUrl()}${path}`;
  const key = apiKey();
  const now = () => new Date().toISOString();

  if (!key) {
    return {
      status: "NOT_CONFIGURED",
      endpoint,
      path,
      payload: null,
      httpStatus: null,
      errorMessage:
        "API_FOOTBALL_KEY ausente no servidor. Fonte não configurada; nenhuma coleta realizada.",
      fetchedAt: now(),
      fromCache: false,
    };
  }

  const cached = cache.get(endpoint);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      status: "OK",
      endpoint,
      path,
      payload: cached.payload as T,
      httpStatus: cached.httpStatus,
      errorMessage: null,
      fetchedAt: cached.fetchedAt,
      fromCache: true,
    };
  }

  let lastError = "Falha desconhecida";
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await throttle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "x-apisports-key": key,
        },
      });
      lastStatus = res.status;

      if (res.status === 401 || res.status === 403) {
        return {
          status: "UNAVAILABLE",
          endpoint,
          path,
          payload: null,
          httpStatus: res.status,
          errorMessage: `Credencial rejeitada pela fonte (HTTP ${res.status}). Nenhuma tentativa de contorno.`,
          fetchedAt: now(),
          fromCache: false,
        };
      }

      if (res.status === 429) {
        lastError = "Rate limit / cota da fonte (HTTP 429).";
      } else if (!res.ok) {
        lastError = `HTTP ${res.status} ao consultar ${path}.`;
      } else {
        const payload = (await res.json()) as T;
        // A API-Sports responde 200 com envelope de erro; isso é indisponibilidade, não sucesso.
        const errors = (payload as { errors?: unknown })?.errors;
        const errorList =
          errors && typeof errors === "object" ? Object.values(errors as object).filter(Boolean) : [];
        if (errorList.length > 0) {
          return {
            status: "UNAVAILABLE",
            endpoint,
            path,
            payload: null,
            httpStatus: res.status,
            errorMessage: `Erro reportado pela fonte: ${errorList.join(" | ")}`,
            fetchedAt: now(),
            fromCache: false,
          };
        }
        const fetchedAt = now();
        cache.set(endpoint, {
          payload,
          httpStatus: res.status,
          fetchedAt,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
        return {
          status: "OK",
          endpoint,
          path,
          payload,
          httpStatus: res.status,
          errorMessage: null,
          fetchedAt,
          fromCache: false,
        };
      }
    } catch (error) {
      lastError =
        error instanceof Error && error.name === "AbortError"
          ? `Timeout de ${TIMEOUT_MS} ms em ${path}.`
          : error instanceof Error
            ? error.message
            : "Falha de rede desconhecida.";
    } finally {
      clearTimeout(timer);
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 600 * 2 ** (attempt - 1)));
    }
  }

  return {
    status: "UNAVAILABLE",
    endpoint,
    path,
    payload: null,
    httpStatus: lastStatus,
    errorMessage: lastError,
    fetchedAt: new Date().toISOString(),
    fromCache: false,
  };
}

export interface ApiFootballResolution {
  resolution: MatchResolution | null;
  fetch: ApiFootballFetch;
  events: ProviderEvent[];
}

/** Identifica a fixture correspondente ao jogo do CSV pela agenda do dia. */
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
  /** endpoint de origem, para lineage */
  endpoint: string;
  fetchedAt: string;
  /** kickoff do jogo histórico de onde a métrica veio */
  observedAt: string | null;
  fixtureId: number;
}

export interface ApiFootballHistory {
  observations: ApiFootballRawObservation[];
  fetches: ApiFootballFetch[];
  eventsConsidered: number;
  rawStatsReceived: number;
}

/**
 * Histórico pré-jogo de um time: últimas partidas encerradas ANTES de prediction_at,
 * com placar e estatísticas de partida. Nunca usa informação posterior ao prediction_at.
 */
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
    .filter(
      (e) =>
        e.statusType === "finished" &&
        e.startTimestamp !== null &&
        e.startTimestamp * 1000 < Date.parse(predictionAtIso),
    )
    .sort((a, b) => (b.startTimestamp ?? 0) - (a.startTimestamp ?? 0))
    .slice(0, maxEvents);

  for (const event of events) {
    const observedAt = event.startTimestamp
      ? new Date(event.startTimestamp * 1000).toISOString()
      : null;

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
