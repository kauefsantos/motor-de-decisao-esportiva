// Adapter SofaScore. Server-only.
// Regras: nenhum contorno de anti-bot/rate limit/autenticação; endpoints estruturados apenas;
// timeout, retry limitado com backoff, rate limiting conservador e cache de payload bruto.

import {
  parseScheduledEvents,
  resolveEvent,
  mapStatistics,
  goalsFromEvent,
  type CsvMatchQuery,
  type MatchResolution,
  type NormalizedStat,
  type SofascoreEvent,
} from "./sofascore.parse";

export const SOFASCORE_DEFINITION_VERSION = "sofascore-v1";

const DEFAULT_BASE = "https://api.sofascore.com/api/v1";
const TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3;
const MIN_INTERVAL_MS = 1200; // rate limiting conservador: ~0,8 req/s
const CACHE_TTL_MS = 10 * 60 * 1000;

export type SofascoreFetchStatus = "OK" | "UNAVAILABLE" | "NOT_CONFIGURED";

export interface SofascoreFetch<T = unknown> {
  status: SofascoreFetchStatus;
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

function baseUrl(): string {
  return process.env["SOFASCORE_API_BASE"]?.replace(/\/$/, "") || DEFAULT_BASE;
}

async function throttle() {
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

/** GET estruturado com timeout, retry limitado e backoff exponencial. Nunca simula resposta. */
export async function sofascoreGet<T = unknown>(path: string): Promise<SofascoreFetch<T>> {
  const url = `${baseUrl()}${path}`;
  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      status: "OK",
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
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          // Identificação honesta: nenhum spoofing de navegador para burlar anti-bot.
          "User-Agent": "BetValueEngine/2.1.1 (pre-match analytics)",
        },
      });
      lastStatus = res.status;

      if (res.status === 403 || res.status === 401) {
        // Controle de acesso da fonte: não tentar contornar, encerrar imediatamente.
        return {
          status: "UNAVAILABLE",
          path,
          payload: null,
          httpStatus: res.status,
          errorMessage: `Acesso negado pela fonte (HTTP ${res.status}). Endpoint público bloqueado; nenhuma tentativa de contorno foi feita.`,
          fetchedAt: new Date().toISOString(),
          fromCache: false,
        };
      }

      if (res.status === 429) {
        lastError = "Rate limit da fonte (HTTP 429).";
      } else if (!res.ok) {
        lastError = `HTTP ${res.status} ao consultar ${path}.`;
      } else {
        const payload = (await res.json()) as T;
        const fetchedAt = new Date().toISOString();
        cache.set(url, {
          payload,
          httpStatus: res.status,
          fetchedAt,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
        return {
          status: "OK",
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
    path,
    payload: null,
    httpStatus: lastStatus,
    errorMessage: lastError,
    fetchedAt: new Date().toISOString(),
    fromCache: false,
  };
}

export interface SofascoreResolution {
  resolution: MatchResolution | null;
  fetch: SofascoreFetch;
  events: SofascoreEvent[];
}

/** Tenta identificar o evento correspondente ao jogo do CSV pela agenda do dia. */
export async function sofascoreResolveMatch(
  query: CsvMatchQuery,
  isoDate: string,
): Promise<SofascoreResolution> {
  const res = await sofascoreGet(`/sport/football/scheduled-events/${isoDate}`);
  if (res.status !== "OK" || res.payload === null) {
    return { resolution: null, fetch: res, events: [] };
  }
  const events = parseScheduledEvents(res.payload);
  return { resolution: resolveEvent(query, events), fetch: res, events };
}

export interface SofascoreHistory {
  observations: NormalizedStat[];
  fetches: SofascoreFetch[];
  eventsConsidered: number;
}

/**
 * Coleta histórica pré-jogo de um time: últimos eventos encerrados antes de prediction_at,
 * com placar e, quando disponível, estatísticas de partida.
 */
export async function sofascoreTeamHistory(
  teamId: number,
  predictionAtIso: string,
  maxEvents = 5,
): Promise<SofascoreHistory> {
  const fetches: SofascoreFetch[] = [];
  const observations: NormalizedStat[] = [];

  const last = await sofascoreGet(`/team/${teamId}/events/last/0`);
  fetches.push(last);
  if (last.status !== "OK" || last.payload === null) {
    return { observations, fetches, eventsConsidered: 0 };
  }

  const events = parseScheduledEvents(last.payload)
    .filter(
      (e) =>
        e.statusType === "finished" &&
        e.startTimestamp !== null &&
        e.startTimestamp * 1000 < Date.parse(predictionAtIso),
    )
    .sort((a, b) => (b.startTimestamp ?? 0) - (a.startTimestamp ?? 0))
    .slice(0, maxEvents);

  for (const event of events) {
    observations.push(...goalsFromEvent(event, predictionAtIso));
    const stats = await sofascoreGet(`/event/${event.eventId}/statistics`);
    fetches.push(stats);
    if (stats.status === "OK" && stats.payload !== null) {
      observations.push(...mapStatistics(stats.payload));
    }
  }

  return { observations, fetches, eventsConsidered: events.length };
}
