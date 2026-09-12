from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise RuntimeError(f"expected snippet not found in {path}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def replace_between(path: str, start: str, end: str, replacement: str) -> None:
    text = read(path)
    a = text.find(start)
    if a < 0:
        raise RuntimeError(f"start marker not found in {path}: {start!r}")
    b = text.find(end, a)
    if b < 0:
        raise RuntimeError(f"end marker not found in {path}: {end!r}")
    write(path, text[:a] + replacement + text[b:])


# -----------------------------------------------------------------------------
# Pure HTTP retry policy + timezone utility
# -----------------------------------------------------------------------------
write("src/lib/http-retry.ts", r'''export const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 500, 502, 503, 504]);

export function isTransientHttpStatus(status: number) {
  return TRANSIENT_HTTP_STATUSES.has(status);
}

export function retryDelayMs(attempt: number, random: () => number = Math.random) {
  const boundedAttempt = Math.max(1, Math.min(attempt, 6));
  const base = 350 * 2 ** (boundedAttempt - 1);
  const jitter = Math.floor(Math.max(0, Math.min(1, random())) * 180);
  return Math.min(5_000, base + jitter);
}
''')

write("src/lib/http-retry.test.ts", r'''import { describe, expect, it } from "vitest";

import { isTransientHttpStatus, retryDelayMs } from "./http-retry";

describe("HTTP transient retry policy", () => {
  it("retries only temporary transport/server statuses", () => {
    for (const code of [408, 425, 500, 502, 503, 504]) expect(isTransientHttpStatus(code)).toBe(true);
    for (const code of [400, 401, 403, 404, 409, 422, 429]) expect(isTransientHttpStatus(code)).toBe(false);
  });

  it("uses bounded exponential backoff with jitter", () => {
    expect(retryDelayMs(1, () => 0)).toBe(350);
    expect(retryDelayMs(2, () => 0)).toBe(700);
    expect(retryDelayMs(3, () => 0)).toBe(1400);
    expect(retryDelayMs(10, () => 1)).toBeLessThanOrEqual(5000);
  });
});
''')

write("src/lib/sao-paulo-time.ts", r'''export const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SAO_PAULO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partsAt(date: Date) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetMsAt(epochMs: number) {
  const p = partsAt(new Date(epochMs));
  const representedAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return representedAsUtc - Math.floor(epochMs / 1000) * 1000;
}

function parseDate(isoDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`Data local inválida: ${isoDate}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function parseTime(hhmm: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new Error(`Horário local inválido: ${hhmm}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Horário local inválido: ${hhmm}`);
  return { hour, minute };
}

export function saoPauloLocalDateTimeToIso(isoDate: string, hhmm: string) {
  const d = parseDate(isoDate);
  const t = parseTime(hhmm);
  const wallClockUtc = Date.UTC(d.year, d.month - 1, d.day, t.hour, t.minute, 0);
  let candidate = wallClockUtc;

  // Two/three passes resolve the zone offset around historical DST boundaries
  // without hard-coding UTC-3 or UTC-2.
  for (let i = 0; i < 4; i += 1) {
    const next = wallClockUtc - offsetMsAt(candidate);
    if (Math.abs(next - candidate) < 1000) {
      candidate = next;
      break;
    }
    candidate = next;
  }
  return new Date(candidate).toISOString();
}

function addCalendarDays(isoDate: string, days: number) {
  const d = parseDate(isoDate);
  const noon = new Date(Date.UTC(d.year, d.month - 1, d.day + days, 12));
  return noon.toISOString().slice(0, 10);
}

export function saoPauloLocalDayUnixWindow(isoDate: string) {
  const startMs = Date.parse(saoPauloLocalDateTimeToIso(isoDate, "00:00"));
  const nextDate = addCalendarDays(isoDate, 1);
  const endMs = Date.parse(saoPauloLocalDateTimeToIso(nextDate, "00:00"));
  return { start: Math.floor(startMs / 1000), end: Math.floor(endMs / 1000) };
}
''')

write("src/lib/sao-paulo-time.test.ts", r'''import { describe, expect, it } from "vitest";

import { saoPauloLocalDateTimeToIso, saoPauloLocalDayUnixWindow } from "./sao-paulo-time";

describe("America/Sao_Paulo timezone conversion", () => {
  it("uses current standard UTC-3 without hard-coding the offset", () => {
    expect(saoPauloLocalDateTimeToIso("2026-09-12", "12:00")).toBe("2026-09-12T15:00:00.000Z");
  });

  it("honors historical daylight saving UTC-2", () => {
    expect(saoPauloLocalDateTimeToIso("2019-01-15", "12:00")).toBe("2019-01-15T14:00:00.000Z");
    const window = saoPauloLocalDayUnixWindow("2019-01-15");
    expect(new Date(window.start * 1000).toISOString()).toBe("2019-01-15T02:00:00.000Z");
    expect(new Date(window.end * 1000).toISOString()).toBe("2019-01-16T02:00:00.000Z");
  });
});
''')

# -----------------------------------------------------------------------------
# Pipeline timezone use
# -----------------------------------------------------------------------------
replace_once(
    "src/lib/pipeline.server.ts",
    'import { isCrossLeagueCompetitionName } from "./competition-kind";\n',
    'import { isCrossLeagueCompetitionName } from "./competition-kind";\nimport { saoPauloLocalDateTimeToIso } from "./sao-paulo-time";\n',
)
replace_once(
    "src/lib/pipeline.server.ts",
    '  const hh = m[1]!.padStart(2, "0");\n  return `${targetDate}T${hh}:${m[2]}:00-03:00`;\n',
    '  const hh = m[1]!.padStart(2, "0");\n  return saoPauloLocalDateTimeToIso(targetDate, `${hh}:${m[2]}`);\n',
)

# -----------------------------------------------------------------------------
# FiveDollar: retry every transient attempt through distributed limiter + IANA day
# -----------------------------------------------------------------------------
replace_once(
    "src/lib/adapters/five_dollar.server.ts",
    'import type { CsvMatchQuery, MatchResolution } from "./football.shared";\n',
    'import type { CsvMatchQuery, MatchResolution } from "./football.shared";\nimport { isTransientHttpStatus, retryDelayMs } from "../http-retry";\nimport { saoPauloLocalDayUnixWindow } from "../sao-paulo-time";\n',
)
replace_once(
    "src/lib/adapters/five_dollar.server.ts",
    'const TIMEOUT_MS = 15000;\n',
    'const TIMEOUT_MS = 15000;\nconst MAX_ATTEMPTS = 3;\n',
)
replace_once(
    "src/lib/adapters/five_dollar.server.ts",
    '  fromCache: boolean;\n  rateLimit:',
    '  fromCache: boolean;\n  attempts: number;\n  rateLimit:',
)

five_get = r'''export async function fiveDollarGet<T = unknown>(
  path: string,
  options?: { cacheTtlMs?: number; bypassCache?: boolean },
): Promise<FiveDollarFetch<T>> {
  const endpoint = `${BASE}${path}`;
  const now = () => new Date().toISOString();
  const key = apiKey();
  const ttlMs = options?.cacheTtlMs ?? CACHE_TTL_MS;
  const base = { endpoint, path, payload: null, fromCache: false, attempts: 0, rateLimit: { ...lastHeaders } };

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

  let lastStatus: number | null = null;
  let lastError = "Falha externa desconhecida.";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // Every retry consumes a fresh shared slot. This prevents retries from
    // bypassing the cross-instance provider budget.
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
      lastStatus = res.status;
      readRateHeaders(res);

      if (res.status === 429) {
        rateLimitHits += 1;
        const retryAfter = Number(res.headers.get("retry-after") ?? "60");
        const safeRetry = Number.isFinite(retryAfter) ? retryAfter : 60;
        rateBlockedUntil = Date.now() + safeRetry * 1000;
        await markDistributedRateLimit(safeRetry);
        return { ...base, attempts: attempt, status: "RATE_LIMITED", httpStatus: 429, errorMessage: `HTTP 429 na fonte; aguardando ${safeRetry}s conforme Retry-After. Etapa encerrada em estado parcial.`, fetchedAt: now(), rateLimit: { ...lastHeaders } };
      }

      if (!res.ok) {
        lastError = `HTTP ${res.status} em ${path}.`;
        if (isTransientHttpStatus(res.status) && attempt < MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
          continue;
        }
        return { ...base, attempts: attempt, status: "UNAVAILABLE", httpStatus: res.status, errorMessage: lastError, fetchedAt: now(), rateLimit: { ...lastHeaders } };
      }

      const payload = (await res.json()) as T;
      const envelope = payload as { success?: unknown; error?: { message?: string; code?: string } };
      if (envelope?.success === 0 || envelope?.error) {
        return { ...base, attempts: attempt, status: "UNAVAILABLE", httpStatus: res.status, errorMessage: `Erro reportado pela fonte em ${path}: ${envelope?.error?.message ?? "sem detalhe"}`, fetchedAt: now(), rateLimit: { ...lastHeaders } };
      }

      const fetchedAt = now();
      const entry = { payload, httpStatus: res.status, fetchedAt, expiresAt: Date.now() + ttlMs };
      cache.set(endpoint, entry);
      await writeDistributedCache(endpoint, payload, res.status, fetchedAt, ttlMs);
      return { ...base, attempts: attempt, status: "OK", payload, httpStatus: res.status, errorMessage: null, fetchedAt, rateLimit: { ...lastHeaders } };
    } catch (error) {
      lastError = error instanceof Error && error.name === "AbortError"
        ? `Timeout de ${TIMEOUT_MS} ms em ${path}.`
        : error instanceof Error ? error.message : "Falha de rede desconhecida.";
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
        continue;
      }
      return { ...base, attempts: attempt, status: "UNAVAILABLE", httpStatus: lastStatus, errorMessage: lastError, fetchedAt: now() };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ...base, attempts: MAX_ATTEMPTS, status: "UNAVAILABLE", httpStatus: lastStatus, errorMessage: lastError, fetchedAt: now() };
}

'''
replace_between("src/lib/adapters/five_dollar.server.ts", "export async function fiveDollarGet", "function record", five_get)
replace_once(
    "src/lib/adapters/five_dollar.server.ts",
    '  const start = Math.floor(Date.parse(`${isoDate}T03:00:00Z`) / 1000);\n  const end = start + 24 * 3600;\n',
    '  const { start, end } = saoPauloLocalDayUnixWindow(isoDate);\n',
)
replace_once(
    "src/lib/adapters/five_dollar.server.ts",
    '    fromCache: false,\n    rateLimit: { ...lastHeaders },\n',
    '    fromCache: false,\n    attempts: 0,\n    rateLimit: { ...lastHeaders },\n',
)

# -----------------------------------------------------------------------------
# API-Football: distributed cache/rate state; local controls remain fallback.
# -----------------------------------------------------------------------------
replace_once(
    "src/lib/adapters/api_football.server.ts",
    'import type { CsvMatchQuery, MatchResolution, NormalizedStat } from "./football.shared";\n',
    'import type { CsvMatchQuery, MatchResolution, NormalizedStat } from "./football.shared";\nimport { isTransientHttpStatus, retryDelayMs } from "../http-retry";\n',
)

api_transport = r'''const cache = new Map<string, CacheEntry>();
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

'''
replace_between("src/lib/adapters/api_football.server.ts", "const cache = new Map", "export interface ApiFootballResolution", api_transport)

# -----------------------------------------------------------------------------
# Push delivery: bounded request timeout + retry-friendly result state.
# -----------------------------------------------------------------------------
write("src/lib/push.server.ts", r'''import {
  createECDH,
  createHash,
  createPrivateKey,
  sign as cryptoSign,
} from "node:crypto";

import { isTrustedPushEndpoint } from "./push-endpoint";

const P256_ORDER = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const PUSH_TIMEOUT_MS = 10_000;

function base64Url(value: Uint8Array | Buffer) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function deriveVapidKeyPair() {
  const rootSecret = process.env["LOVABLE_CRON_SECRET"];
  if (!rootSecret) throw new Error("LOVABLE_CRON_SECRET ausente no servidor.");
  const digest = createHash("sha256").update("bet-value-web-push-v1\0", "utf8").update(rootSecret, "utf8").digest();
  const scalar = (BigInt(`0x${digest.toString("hex")}`) % (P256_ORDER - 1n)) + 1n;
  const privateBytes = Buffer.from(scalar.toString(16).padStart(64, "0"), "hex");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(privateBytes);
  const publicBytes = ecdh.getPublicKey(undefined, "uncompressed");
  const x = publicBytes.subarray(1, 33);
  const y = publicBytes.subarray(33, 65);
  const privateKey = createPrivateKey({ key: { kty: "EC", crv: "P-256", x: base64Url(x), y: base64Url(y), d: base64Url(privateBytes) }, format: "jwk" });
  return { publicKey: base64Url(publicBytes), privateKey };
}

function makeVapidAuthorization(endpoint: string) {
  const { publicKey, privateKey } = deriveVapidKeyPair();
  const audience = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = base64Url(Buffer.from(JSON.stringify({ aud: audience, exp: now + 12 * 60 * 60, sub: "https://quant-football-insights.lovable.app" })));
  const unsigned = `${header}.${payload}`;
  const signature = cryptoSign("sha256", Buffer.from(unsigned), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return { publicKey, authorization: `vapid t=${unsigned}.${base64Url(signature)}, k=${publicKey}` };
}

export function getVapidPublicKey() {
  return deriveVapidKeyPair().publicKey;
}

type DeliveryState = { resolvedSubscriptionIds?: string[] } | null | undefined;

export async function deliverAnalysisReadyPush(userId: string, state?: DeliveryState) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: subscriptions, error } = await db.from("push_subscriptions").select("id, endpoint").eq("user_id", userId);
  if (error) throw error;

  const resolved = new Set<string>(state?.resolvedSubscriptionIds ?? []);
  let sent = 0;
  let removed = 0;
  let transientFailed = 0;
  let permanentFailed = 0;
  let lastError: string | null = null;

  for (const subscription of subscriptions ?? []) {
    if (resolved.has(subscription.id)) continue;
    if (!isTrustedPushEndpoint(subscription.endpoint)) {
      await db.from("push_subscriptions").delete().eq("id", subscription.id);
      resolved.add(subscription.id);
      removed += 1;
      continue;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
    try {
      const { authorization } = makeVapidAuthorization(subscription.endpoint);
      const response = await fetch(subscription.endpoint, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: { Authorization: authorization, TTL: "900", Urgency: "normal" },
      });
      if (response.ok) {
        resolved.add(subscription.id);
        sent += 1;
      } else if (response.status === 404 || response.status === 410) {
        await db.from("push_subscriptions").delete().eq("id", subscription.id);
        resolved.add(subscription.id);
        removed += 1;
      } else if (response.status === 429 || response.status >= 500) {
        transientFailed += 1;
        lastError = `Web Push temporariamente indisponível (HTTP ${response.status}).`;
      } else {
        permanentFailed += 1;
        lastError = `Web Push rejeitou a entrega (HTTP ${response.status}).`;
      }
    } catch (error) {
      transientFailed += 1;
      lastError = error instanceof Error && error.name === "AbortError"
        ? `Timeout de ${PUSH_TIMEOUT_MS} ms no Web Push.`
        : error instanceof Error ? error.message : "Falha de rede no Web Push.";
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    sent,
    removed,
    transientFailed,
    permanentFailed,
    lastError,
    deliveryState: { resolvedSubscriptionIds: [...resolved] },
  };
}

// Kept for compatibility with any older internal caller; new analysis completion
// uses the durable outbox and dispatcher route.
export async function sendAnalysisReadyPush(userId: string) {
  const result = await deliverAnalysisReadyPush(userId);
  return { sent: result.sent, removed: result.removed, failed: result.transientFailed + result.permanentFailed };
}
''')

# -----------------------------------------------------------------------------
# Worker route: short renewable lease, heartbeat, fenced transitions, outbox.
# -----------------------------------------------------------------------------
write("src/routes/api.analysis-worker.ts", r'''import { createFileRoute } from "@tanstack/react-router";

import { backendErrorResponse, backendJson, backendRequestId } from "@/lib/backend-contract";
import { createFixedWindowRequestLimiter, readBoundedJsonObject } from "@/lib/analysis-worker-security";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const enforceWorkerRateLimit = createFixedWindowRequestLimiter();

export const Route = createFileRoute("/api/analysis-worker")({
  server: {
    handlers: {
      GET: async () => {
        const requestId = backendRequestId();
        return Response.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "Method Not Allowed" }, requestId }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
      },
      POST: async ({ request }) => {
        const requestId = backendRequestId();
        const rateLimited = enforceWorkerRateLimit(request);
        if (rateLimited) return rateLimited;
        const body = await readBoundedJsonObject(request);
        if (!body) return backendJson({ status: "IGNORED" as const }, { status: 202 }, requestId);
        const runId = typeof body.runId === "string" ? body.runId : "";
        const dispatchToken = typeof body.dispatchToken === "string" ? body.dispatchToken : "";
        if (!UUID_RE.test(runId) || !UUID_RE.test(dispatchToken)) return backendJson({ status: "IGNORED" as const }, { status: 202 }, requestId);

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const db = supabaseAdmin as any;
          const { data: claimed, error: claimError } = await db.rpc("claim_analysis_job", { p_run_id: runId, p_dispatch_token: dispatchToken });
          if (claimError) return Response.json({ ok: false, error: { code: "INTERNAL_ERROR", message: "Não foi possível reservar o processamento." }, requestId }, { status: 500, headers: { "Cache-Control": "no-store" } });
          const job = claimed?.[0];
          if (!job) return backendJson({ status: "IDLE" as const }, { status: 202 }, requestId);
          const leaseToken = String(job.lease_token ?? "");
          if (!UUID_RE.test(leaseToken)) return backendJson({ status: "LEASE_LOST" as const }, { status: 202 }, requestId);
          const completed = new Set<string>(job.completed_steps ?? []);

          const [{ PIPELINE_STEPS }, { executeStep }] = await Promise.all([
            import("@/lib/pipeline.steps"),
            import("@/lib/pipeline.server"),
          ]);
          const nextStep = PIPELINE_STEPS.find((step) => !completed.has(step.key));
          if (!nextStep) {
            const { data: finalRows } = await db.rpc("complete_analysis_job_step_atomic", { p_run_id: runId, p_lease_token: leaseToken, p_step: null, p_finished: true });
            const accepted = Boolean((Array.isArray(finalRows) ? finalRows[0] : finalRows)?.accepted);
            return backendJson({ status: accepted ? ("DONE" as const) : ("LEASE_LOST" as const), runId }, accepted ? undefined : { status: 202 }, requestId);
          }

          const { data: startedRows } = await db.rpc("start_analysis_job_step_atomic", { p_run_id: runId, p_lease_token: leaseToken, p_step: nextStep.key });
          if (!Boolean((Array.isArray(startedRows) ? startedRows[0] : startedRows)?.accepted)) {
            return backendJson({ status: "LEASE_LOST" as const, runId }, { status: 202 }, requestId);
          }

          let leaseLost = false;
          let heartbeatBusy = false;
          const heartbeat = async () => {
            if (heartbeatBusy || leaseLost) return;
            heartbeatBusy = true;
            try {
              const { data, error } = await db.rpc("heartbeat_analysis_job", { p_run_id: runId, p_lease_token: leaseToken });
              if (!error && data === false) leaseLost = true;
            } finally {
              heartbeatBusy = false;
            }
          };
          const heartbeatTimer = setInterval(() => void heartbeat(), 25_000);

          try {
            await executeStep(runId, nextStep.key);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Falha desconhecida no processamento.";
            const { data: failedRows } = await db.rpc("fail_analysis_job_atomic", { p_run_id: runId, p_lease_token: leaseToken, p_error: message.slice(0, 1000) });
            const accepted = Boolean((Array.isArray(failedRows) ? failedRows[0] : failedRows)?.accepted);
            if (accepted) await db.from("analysis_runs").update({ status: "ERROR", updated_at: new Date().toISOString() }).eq("id", runId);
            return Response.json({ ok: false, error: { code: accepted ? "INTERNAL_ERROR" : "CONFLICT", message: accepted ? "O processamento da análise falhou." : "O worker perdeu a reserva desta análise." }, requestId }, { status: accepted ? 500 : 409, headers: { "Cache-Control": "no-store" } });
          } finally {
            clearInterval(heartbeatTimer);
          }

          if (leaseLost) return backendJson({ status: "LEASE_LOST" as const, runId, step: nextStep.key }, { status: 202 }, requestId);
          completed.add(nextStep.key);
          const finished = completed.size === PIPELINE_STEPS.length;
          const { data: completeRows, error: completeError } = await db.rpc("complete_analysis_job_step_atomic", {
            p_run_id: runId,
            p_lease_token: leaseToken,
            p_step: nextStep.key,
            p_finished: finished,
          });
          if (completeError) throw completeError;
          const accepted = Boolean((Array.isArray(completeRows) ? completeRows[0] : completeRows)?.accepted);
          if (!accepted) return backendJson({ status: "LEASE_LOST" as const, runId, step: nextStep.key }, { status: 202 }, requestId);

          if (finished) {
            await db.rpc("enqueue_push_delivery_event", {
              p_event_key: `analysis-ready:${runId}`,
              p_user_id: job.user_id,
              p_event_type: "ANALYSIS_READY",
              p_payload: { runId },
            });
            await db.rpc("kick_push_delivery_dispatcher");
            return backendJson({ status: "DONE" as const, runId, step: nextStep.key }, undefined, requestId);
          }

          const { error: kickError } = await db.rpc("kick_analysis_worker");
          if (kickError) console.error("[Analysis worker] next-step dispatch failed", kickError);
          return backendJson({ status: "STEP_DONE" as const, runId, step: nextStep.key }, undefined, requestId);
        } catch (error) {
          console.error("[Analysis worker] unexpected failure", error);
          return backendErrorResponse(error, requestId);
        }
      },
    },
  },
});
''')

# -----------------------------------------------------------------------------
# Protected push dispatcher route
# -----------------------------------------------------------------------------
write("src/routes/api.push-dispatch.ts", r'''import { createFileRoute } from "@tanstack/react-router";

import { backendErrorResponse, backendJson, backendRequestId } from "@/lib/backend-contract";
import { createFixedWindowRequestLimiter } from "@/lib/analysis-worker-security";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const limitPushDispatch = createFixedWindowRequestLimiter({ limit: 12, windowMs: 60_000 });

export const Route = createFileRoute("/api/push-dispatch")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "Method Not Allowed" } }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } }),
      POST: async ({ request }) => {
        const requestId = backendRequestId();
        const limited = limitPushDispatch(request);
        if (limited) return limited;
        const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "");
        const token = match?.[1] ?? "";
        if (!UUID_RE.test(token)) return Response.json({ ok: false, error: { code: "FORBIDDEN", message: "Solicitação não autorizada." }, requestId }, { status: 403, headers: { "Cache-Control": "no-store" } });

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const db = supabaseAdmin as any;
          const { data: allowed, error: authError } = await db.rpc("validate_push_dispatch_token", { p_token: token });
          if (authError || allowed !== true) return Response.json({ ok: false, error: { code: "FORBIDDEN", message: "Solicitação não autorizada." }, requestId }, { status: 403, headers: { "Cache-Control": "no-store" } });

          const { data: events, error: claimError } = await db.rpc("claim_push_delivery_batch", { p_limit: 5 });
          if (claimError) throw claimError;
          const { deliverAnalysisReadyPush } = await import("@/lib/push.server");
          let sent = 0;
          let retried = 0;
          let dead = 0;

          for (const event of events ?? []) {
            const result = await deliverAnalysisReadyPush(event.user_id, event.delivery_state);
            sent += result.sent;
            if (result.transientFailed > 0) {
              await db.rpc("fail_push_delivery_event", {
                p_id: event.id,
                p_lock_token: event.lock_token,
                p_error: result.lastError ?? "Falha temporária no Web Push.",
                p_retryable: true,
                p_delivery_state: result.deliveryState,
              });
              retried += 1;
            } else if (result.permanentFailed > 0) {
              await db.rpc("fail_push_delivery_event", {
                p_id: event.id,
                p_lock_token: event.lock_token,
                p_error: result.lastError ?? "Falha permanente no Web Push.",
                p_retryable: false,
                p_delivery_state: result.deliveryState,
              });
              dead += 1;
            } else {
              await db.rpc("complete_push_delivery_event", { p_id: event.id, p_lock_token: event.lock_token, p_delivery_state: result.deliveryState });
            }
          }

          return backendJson({ status: "OK" as const, claimed: events?.length ?? 0, sent, retried, dead }, undefined, requestId);
        } catch (error) {
          console.error("[Push dispatcher] failed", error);
          return backendErrorResponse(error, requestId);
        }
      },
    },
  },
});
''')

# -----------------------------------------------------------------------------
# Route tree registration for push dispatcher
# -----------------------------------------------------------------------------
replace_once(
    "src/routeTree.gen.ts",
    "import { Route as ApiFiveDollarMaintenanceRouteImport } from './routes/api.five-dollar-maintenance'\n",
    "import { Route as ApiFiveDollarMaintenanceRouteImport } from './routes/api.five-dollar-maintenance'\nimport { Route as ApiPushDispatchRouteImport } from './routes/api.push-dispatch'\n",
)
replace_once(
    "src/routeTree.gen.ts",
    "const ApiFiveDollarMaintenanceRoute = ApiFiveDollarMaintenanceRouteImport.update({ id: '/api/five-dollar-maintenance', path: '/api/five-dollar-maintenance', getParentRoute: () => rootRouteImport } as any)\n",
    "const ApiFiveDollarMaintenanceRoute = ApiFiveDollarMaintenanceRouteImport.update({ id: '/api/five-dollar-maintenance', path: '/api/five-dollar-maintenance', getParentRoute: () => rootRouteImport } as any)\nconst ApiPushDispatchRoute = ApiPushDispatchRouteImport.update({ id: '/api/push-dispatch', path: '/api/push-dispatch', getParentRoute: () => rootRouteImport } as any)\n",
)
for marker, insertion in [
    ("  '/api/five-dollar-maintenance': typeof ApiFiveDollarMaintenanceRoute\n", "  '/api/five-dollar-maintenance': typeof ApiFiveDollarMaintenanceRoute\n  '/api/push-dispatch': typeof ApiPushDispatchRoute\n"),
    ("  ApiFiveDollarMaintenanceRoute: typeof ApiFiveDollarMaintenanceRoute\n", "  ApiFiveDollarMaintenanceRoute: typeof ApiFiveDollarMaintenanceRoute\n  ApiPushDispatchRoute: typeof ApiPushDispatchRoute\n"),
    ("    '/api/five-dollar-maintenance': { id: '/api/five-dollar-maintenance'; path: '/api/five-dollar-maintenance'; fullPath: '/api/five-dollar-maintenance'; preLoaderRoute: typeof ApiFiveDollarMaintenanceRouteImport; parentRoute: typeof rootRouteImport }\n", "    '/api/five-dollar-maintenance': { id: '/api/five-dollar-maintenance'; path: '/api/five-dollar-maintenance'; fullPath: '/api/five-dollar-maintenance'; preLoaderRoute: typeof ApiFiveDollarMaintenanceRouteImport; parentRoute: typeof rootRouteImport }\n    '/api/push-dispatch': { id: '/api/push-dispatch'; path: '/api/push-dispatch'; fullPath: '/api/push-dispatch'; preLoaderRoute: typeof ApiPushDispatchRouteImport; parentRoute: typeof rootRouteImport }\n"),
    ("  ApiFiveDollarMaintenanceRoute,\n", "  ApiFiveDollarMaintenanceRoute,\n  ApiPushDispatchRoute,\n"),
]:
    replace_once("src/routeTree.gen.ts", marker, insertion)

# FileRoutesById has a second occurrence independent of FileRoutesByFullPath.
text = read("src/routeTree.gen.ts")
needle = "  '/api/five-dollar-maintenance': typeof ApiFiveDollarMaintenanceRoute\n"
occurrences = [m.start() for m in re.finditer(re.escape(needle), text)]
if len(occurrences) == 1:
    # First loop replaced only the first occurrence. Insert into the remaining ID block using elo->five sequence.
    id_anchor = "  '/api/elo-sync': typeof ApiEloSyncRoute\n  '/api/five-dollar-maintenance': typeof ApiFiveDollarMaintenanceRoute\n"
    if id_anchor in text:
        text = text.replace(id_anchor, id_anchor + "  '/api/push-dispatch': typeof ApiPushDispatchRoute\n", 1)
        write("src/routeTree.gen.ts", text)

# -----------------------------------------------------------------------------
# Database resilience migration
# -----------------------------------------------------------------------------
write("supabase/migrations/20260912070000_integrations_automation_resilience.sql", r'''-- Close remaining Integrations & Automations audit findings.
-- Runtime truth: Lovable Cloud. Versioned truth: GitHub main.

-- ---------------------------------------------------------------------------
-- 1) Renewable analysis-job lease + fencing
-- ---------------------------------------------------------------------------
alter table public.analysis_jobs add column if not exists lease_token uuid;
alter table public.analysis_jobs add column if not exists lease_expires_at timestamptz;
create index if not exists idx_analysis_jobs_lease_expiry on public.analysis_jobs(status,lease_expires_at) where status='RUNNING';

create or replace function public.claim_analysis_job(p_run_id uuid,p_dispatch_token uuid)
returns table(run_id uuid,user_id uuid,completed_steps text[],attempts integer,lease_token uuid)
language plpgsql security definer set search_path=''
as $$
declare v_lease uuid:=gen_random_uuid();
begin
  return query
  update public.analysis_jobs j
     set status='RUNNING',attempts=j.attempts+1,locked_at=pg_catalog.now(),
         lease_token=v_lease,lease_expires_at=pg_catalog.now()+interval '90 seconds',
         dispatch_token=gen_random_uuid(),last_error=null,updated_at=pg_catalog.now()
   where j.run_id=p_run_id and j.dispatch_token=p_dispatch_token
     and (j.status='QUEUED' or (j.status='RUNNING' and (j.lease_expires_at is null or j.lease_expires_at<pg_catalog.now())))
  returning j.run_id,j.user_id,j.completed_steps,j.attempts,j.lease_token;
end;$$;
revoke all on function public.claim_analysis_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_analysis_job(uuid,uuid) to service_role;

create or replace function public.heartbeat_analysis_job(p_run_id uuid,p_lease_token uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_changed integer;
begin
  update public.analysis_jobs set locked_at=pg_catalog.now(),lease_expires_at=pg_catalog.now()+interval '90 seconds',updated_at=pg_catalog.now()
   where run_id=p_run_id and status='RUNNING' and lease_token=p_lease_token and lease_expires_at>pg_catalog.now();
  get diagnostics v_changed=row_count; return v_changed=1;
end;$$;
revoke all on function public.heartbeat_analysis_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.heartbeat_analysis_job(uuid,uuid) to service_role;

create or replace function public.start_analysis_job_step_atomic(p_run_id uuid,p_lease_token uuid,p_step text)
returns table(accepted boolean)
language plpgsql security definer set search_path=''
as $$
declare v_changed integer;
begin
  update public.analysis_jobs set current_step=p_step,locked_at=pg_catalog.now(),updated_at=pg_catalog.now()
   where run_id=p_run_id and status='RUNNING' and lease_token=p_lease_token and lease_expires_at>pg_catalog.now();
  get diagnostics v_changed=row_count; return query select v_changed=1;
end;$$;
revoke all on function public.start_analysis_job_step_atomic(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.start_analysis_job_step_atomic(uuid,uuid,text) to service_role;

create or replace function public.complete_analysis_job_step_atomic(p_run_id uuid,p_lease_token uuid,p_step text,p_finished boolean)
returns table(accepted boolean)
language plpgsql security definer set search_path=''
as $$
declare v_changed integer;
begin
  update public.analysis_jobs j
     set status=case when p_finished then 'DONE' else 'QUEUED' end,
         current_step=null,
         completed_steps=case when p_step is null or p_step='' or p_step=any(j.completed_steps) then j.completed_steps else pg_catalog.array_append(j.completed_steps,p_step) end,
         completed_at=case when p_finished then pg_catalog.now() else null end,
         locked_at=null,lease_token=null,lease_expires_at=null,updated_at=pg_catalog.now()
   where j.run_id=p_run_id and j.status='RUNNING' and j.lease_token=p_lease_token and j.lease_expires_at>pg_catalog.now();
  get diagnostics v_changed=row_count; return query select v_changed=1;
end;$$;
revoke all on function public.complete_analysis_job_step_atomic(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.complete_analysis_job_step_atomic(uuid,uuid,text,boolean) to service_role;

create or replace function public.fail_analysis_job_atomic(p_run_id uuid,p_lease_token uuid,p_error text)
returns table(accepted boolean)
language plpgsql security definer set search_path=''
as $$
declare v_changed integer;
begin
  update public.analysis_jobs set status='ERROR',last_error=pg_catalog.left(coalesce(p_error,'Falha desconhecida'),1000),
    locked_at=null,lease_token=null,lease_expires_at=null,updated_at=pg_catalog.now()
   where run_id=p_run_id and status='RUNNING' and lease_token=p_lease_token and lease_expires_at>pg_catalog.now();
  get diagnostics v_changed=row_count; return query select v_changed=1;
end;$$;
revoke all on function public.fail_analysis_job_atomic(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fail_analysis_job_atomic(uuid,uuid,text) to service_role;

-- Retry resets any previous lease and rotates the dispatch capability.
create or replace function public.retry_analysis_job_atomic(p_run_id uuid,p_user_id uuid)
returns table(retried boolean,status text)
language plpgsql security definer set search_path=''
as $$
declare v_changed integer:=0; v_status text;
begin
  update public.analysis_jobs j set status='QUEUED',current_step=null,last_error=null,locked_at=null,
    lease_token=null,lease_expires_at=null,completed_at=null,dispatch_token=gen_random_uuid(),updated_at=pg_catalog.now()
   where j.run_id=p_run_id and j.user_id=p_user_id and j.status='ERROR';
  get diagnostics v_changed=row_count;
  if v_changed=1 then
    update public.analysis_runs r set status='RUNNING',updated_at=pg_catalog.now() where r.id=p_run_id and r.owner_id=p_user_id;
    v_status:='QUEUED';
  else
    select j.status into v_status from public.analysis_jobs j where j.run_id=p_run_id and j.user_id=p_user_id;
  end if;
  return query select v_changed=1,v_status;
end;$$;
revoke all on function public.retry_analysis_job_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.retry_analysis_job_atomic(uuid,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2) Durable Web Push outbox
-- ---------------------------------------------------------------------------
create table if not exists public.push_delivery_outbox(
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}',
  delivery_state jsonb not null default '{"resolvedSubscriptionIds":[]}',
  status text not null default 'PENDING' check(status in ('PENDING','PROCESSING','SENT','DEAD')),
  attempts integer not null default 0 check(attempts>=0 and attempts<=20),
  next_attempt_at timestamptz not null default now(),
  lock_token uuid,
  locked_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_push_delivery_outbox_ready on public.push_delivery_outbox(status,next_attempt_at,created_at);
alter table public.push_delivery_outbox enable row level security;
revoke all on public.push_delivery_outbox from public,anon,authenticated;
grant all on public.push_delivery_outbox to service_role;

create or replace function public.enqueue_push_delivery_event(p_event_key text,p_user_id uuid,p_event_type text,p_payload jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_id uuid;
begin
  insert into public.push_delivery_outbox(event_key,user_id,event_type,payload)
  values(pg_catalog.left(p_event_key,300),p_user_id,pg_catalog.left(p_event_type,80),coalesce(p_payload,'{}'::jsonb))
  on conflict(event_key) do update set event_key=excluded.event_key
  returning id into v_id;
  return v_id;
end;$$;
revoke all on function public.enqueue_push_delivery_event(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_push_delivery_event(text,uuid,text,jsonb) to service_role;

create or replace function public.claim_push_delivery_batch(p_limit integer default 5)
returns setof public.push_delivery_outbox language plpgsql security definer set search_path=''
as $$
begin
  if p_limit<1 or p_limit>20 then raise exception 'Lote de push inválido.'; end if;
  return query
  with picked as (
    select id from public.push_delivery_outbox
     where ((status='PENDING' and next_attempt_at<=pg_catalog.now()) or (status='PROCESSING' and locked_at<pg_catalog.now()-interval '2 minutes'))
       and attempts<5
     order by next_attempt_at,created_at limit p_limit for update skip locked
  )
  update public.push_delivery_outbox o
     set status='PROCESSING',attempts=o.attempts+1,lock_token=gen_random_uuid(),locked_at=pg_catalog.now(),updated_at=pg_catalog.now()
   where o.id in (select id from picked)
  returning o.*;
end;$$;
revoke all on function public.claim_push_delivery_batch(integer) from public,anon,authenticated;
grant execute on function public.claim_push_delivery_batch(integer) to service_role;

create or replace function public.complete_push_delivery_event(p_id uuid,p_lock_token uuid,p_delivery_state jsonb)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_changed integer;
begin
  update public.push_delivery_outbox set status='SENT',delivery_state=coalesce(p_delivery_state,delivery_state),sent_at=pg_catalog.now(),
    lock_token=null,locked_at=null,last_error=null,updated_at=pg_catalog.now()
   where id=p_id and status='PROCESSING' and lock_token=p_lock_token;
  get diagnostics v_changed=row_count; return v_changed=1;
end;$$;
revoke all on function public.complete_push_delivery_event(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.complete_push_delivery_event(uuid,uuid,jsonb) to service_role;

create or replace function public.fail_push_delivery_event(p_id uuid,p_lock_token uuid,p_error text,p_retryable boolean,p_delivery_state jsonb)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_changed integer;
begin
  update public.push_delivery_outbox o set
    status=case when p_retryable and o.attempts<5 then 'PENDING' else 'DEAD' end,
    next_attempt_at=case when p_retryable and o.attempts<5 then pg_catalog.now()+pg_catalog.make_interval(secs=>least(900,30*(2^greatest(0,o.attempts-1)))::integer) else o.next_attempt_at end,
    delivery_state=coalesce(p_delivery_state,o.delivery_state),last_error=pg_catalog.left(coalesce(p_error,'Falha de push'),1000),
    lock_token=null,locked_at=null,updated_at=pg_catalog.now()
   where o.id=p_id and o.status='PROCESSING' and o.lock_token=p_lock_token;
  get diagnostics v_changed=row_count; return v_changed=1;
end;$$;
revoke all on function public.fail_push_delivery_event(uuid,uuid,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.fail_push_delivery_event(uuid,uuid,text,boolean,jsonb) to service_role;

create table if not exists private.push_dispatch_config(
  singleton boolean primary key default true check(singleton),
  dispatch_token uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);
insert into private.push_dispatch_config(singleton) values(true) on conflict(singleton) do nothing;
revoke all on private.push_dispatch_config from public,anon,authenticated;
grant select,update on private.push_dispatch_config to service_role;

create or replace function public.validate_push_dispatch_token(p_token uuid)
returns boolean language sql security definer set search_path='' stable as $$
 select exists(select 1 from private.push_dispatch_config where singleton=true and dispatch_token=p_token)
$$;
revoke all on function public.validate_push_dispatch_token(uuid) from public,anon,authenticated;
grant execute on function public.validate_push_dispatch_token(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Real HTTP automation outcome ledger and reconciliation
-- ---------------------------------------------------------------------------
create table if not exists public.automation_runs(
  id bigint generated always as identity primary key,
  job_name text not null,
  request_id bigint,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'DISPATCHED' check(status in ('DISPATCHED','SUCCESS','FAILED','TIMEOUT')),
  http_status integer,
  error_message text,
  metadata jsonb not null default '{}'
);
create unique index if not exists uq_automation_runs_request on public.automation_runs(request_id) where request_id is not null;
create index if not exists idx_automation_runs_open on public.automation_runs(status,started_at) where status='DISPATCHED';
alter table public.automation_runs enable row level security;
revoke all on public.automation_runs from public,anon,authenticated;
grant all on public.automation_runs to service_role;

create or replace function public.reconcile_automation_runs(p_timeout_minutes integer default 5)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_resolved integer:=0; v_timed_out integer:=0;
begin
  if p_timeout_minutes<1 or p_timeout_minutes>120 then raise exception 'Timeout de reconciliação inválido.'; end if;
  with updated as (
    update public.automation_runs a set
      http_status=r.status_code,
      error_message=case when r.error_msg is null then null else pg_catalog.left(r.error_msg,1000) end,
      status=case when r.status_code between 200 and 299 then 'SUCCESS'
                  when r.status_code is null and lower(coalesce(r.error_msg,'')) like '%timeout%' then 'TIMEOUT'
                  else 'FAILED' end,
      finished_at=pg_catalog.now()
    from net._http_response r
    where a.status='DISPATCHED' and a.request_id=r.id
    returning a.id
  ) select count(*) into v_resolved from updated;

  with expired as (
    update public.automation_runs a set status='TIMEOUT',finished_at=pg_catalog.now(),error_message='Resposta HTTP não reconciliada dentro da janela operacional.'
    where a.status='DISPATCHED' and a.started_at<pg_catalog.now()-pg_catalog.make_interval(mins=>p_timeout_minutes)
      and not exists(select 1 from net._http_response r where r.id=a.request_id)
    returning a.id
  ) select count(*) into v_timed_out from expired;
  return pg_catalog.jsonb_build_object('resolved',v_resolved,'timedOut',v_timed_out);
end;$$;
revoke all on function public.reconcile_automation_runs(integer) from public,anon,authenticated;
grant execute on function public.reconcile_automation_runs(integer) to service_role;

create or replace function public.kick_analysis_worker()
returns bigint language plpgsql security definer set search_path=''
as $$
declare next_run_id uuid; next_dispatch_token uuid; request_id bigint;
begin
  select j.run_id,j.dispatch_token into next_run_id,next_dispatch_token
  from public.analysis_jobs j
  where j.status='QUEUED' or (j.status='RUNNING' and (j.lease_expires_at is null or j.lease_expires_at<pg_catalog.now()))
  order by j.created_at limit 1;
  if next_run_id is null then return null; end if;
  select net.http_post(url:='https://quant-football-insights.lovable.app/api/analysis-worker',
    body:=pg_catalog.jsonb_build_object('runId',next_run_id,'dispatchToken',next_dispatch_token),params:='{}'::jsonb,
    headers:=pg_catalog.jsonb_build_object('Content-Type','application/json'),timeout_milliseconds:=120000) into request_id;
  insert into public.automation_runs(job_name,request_id,metadata) values('analysis-worker-watch',request_id,pg_catalog.jsonb_build_object('runId',next_run_id)) on conflict(request_id) do nothing;
  return request_id;
end;$$;
revoke all on function public.kick_analysis_worker() from public,anon,authenticated;
grant execute on function public.kick_analysis_worker() to service_role;

create or replace function public.kick_external_api_maintenance()
returns bigint language plpgsql security definer set search_path=''
as $$
declare v_token uuid; v_request bigint;
begin
  select dispatch_token into v_token from private.external_api_maintenance_config where singleton=true;
  select net.http_post(url:='https://quant-football-insights.lovable.app/api/five-dollar-maintenance',
    body:=pg_catalog.jsonb_build_object('dispatchToken',v_token),params:='{}'::jsonb,
    headers:=pg_catalog.jsonb_build_object('Content-Type','application/json'),timeout_milliseconds:=120000) into v_request;
  insert into public.automation_runs(job_name,request_id,metadata) values('five-dollar-maintenance-daily',v_request,'{}') on conflict(request_id) do nothing;
  return v_request;
end;$$;
revoke all on function public.kick_external_api_maintenance() from public,anon,authenticated;
grant execute on function public.kick_external_api_maintenance() to service_role;

create or replace function public.kick_push_delivery_dispatcher()
returns bigint language plpgsql security definer set search_path=''
as $$
declare v_token uuid; v_request bigint;
begin
  if not exists(select 1 from public.push_delivery_outbox where (status='PENDING' and next_attempt_at<=pg_catalog.now()) or (status='PROCESSING' and locked_at<pg_catalog.now()-interval '2 minutes')) then return null; end if;
  select dispatch_token into v_token from private.push_dispatch_config where singleton=true;
  select net.http_post(url:='https://quant-football-insights.lovable.app/api/push-dispatch',body:='{}'::jsonb,params:='{}'::jsonb,
    headers:=pg_catalog.jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_token::text),timeout_milliseconds:=60000) into v_request;
  insert into public.automation_runs(job_name,request_id,metadata) values('push-delivery-dispatch',v_request,'{}') on conflict(request_id) do nothing;
  return v_request;
end;$$;
revoke all on function public.kick_push_delivery_dispatcher() from public,anon,authenticated;
grant execute on function public.kick_push_delivery_dispatcher() to service_role;

-- Recovery schedulers. Dispatchers are idempotent/claim-based and bounded.
do $$ begin
  if exists(select 1 from cron.job where jobname='push-delivery-dispatch') then perform cron.unschedule('push-delivery-dispatch'); end if;
  if exists(select 1 from cron.job where jobname='automation-http-reconcile') then perform cron.unschedule('automation-http-reconcile'); end if;
end $$;
select cron.schedule('push-delivery-dispatch','* * * * *','select public.kick_push_delivery_dispatcher();');
select cron.schedule('automation-http-reconcile','* * * * *','select public.reconcile_automation_runs(5);');

insert into public.app_schema_releases(version,migration_name,notes)
values('20260912-integrations-automation-resilience','integrations_automation_resilience',
'FiveDollar transient retries, renewable worker leases/fencing, distributed fallback API coordination, durable Web Push outbox, IANA Sao Paulo time semantics and real HTTP automation outcome reconciliation.')
on conflict(version) do update set migration_name=excluded.migration_name,notes=excluded.notes,applied_at=now();
''')

# -----------------------------------------------------------------------------
# pgTAP regression coverage
# -----------------------------------------------------------------------------
write("supabase/tests/integrations_automation_resilience.test.sql", r'''begin;
select plan(18);

select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='analysis_jobs' and column_name='lease_token'),'analysis job has lease token');
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='analysis_jobs' and column_name='lease_expires_at'),'analysis job has lease expiry');
select ok(has_function_privilege('service_role','public.heartbeat_analysis_job(uuid,uuid)','EXECUTE') and not has_function_privilege('authenticated','public.heartbeat_analysis_job(uuid,uuid)','EXECUTE'),'heartbeat is service-only');
select ok(has_function_privilege('service_role','public.complete_analysis_job_step_atomic(uuid,uuid,text,boolean)','EXECUTE') and not has_function_privilege('authenticated','public.complete_analysis_job_step_atomic(uuid,uuid,text,boolean)','EXECUTE'),'fenced completion is service-only');

select lives_ok($outer$
do $test$
declare
  v_user uuid:='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_run uuid:=gen_random_uuid();
  v_dispatch uuid:=gen_random_uuid();
  v_lease uuid;
  v_ok boolean;
  v_accepted boolean;
begin
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_user,'authenticated','authenticated','lease-test@example.invalid','{"provider":"google","providers":["google"]}','{}',now(),now());
  insert into public.analysis_runs(id,owner_id,status,matches_total) values(v_run,v_user,'CREATED',0);
  insert into public.analysis_jobs(run_id,user_id,dispatch_token,status) values(v_run,v_user,v_dispatch,'QUEUED');
  select lease_token into v_lease from public.claim_analysis_job(v_run,v_dispatch);
  if v_lease is null then raise exception 'lease not created'; end if;
  select public.heartbeat_analysis_job(v_run,v_lease) into v_ok;
  if not v_ok then raise exception 'valid heartbeat rejected'; end if;
  update public.analysis_jobs set lease_expires_at=now()-interval '1 second' where run_id=v_run;
  select public.heartbeat_analysis_job(v_run,v_lease) into v_ok;
  if v_ok then raise exception 'expired heartbeat accepted'; end if;
  select accepted into v_accepted from public.complete_analysis_job_step_atomic(v_run,v_lease,'RESOLVE',false);
  if v_accepted then raise exception 'stale lease completed step'; end if;
end
$test$
$outer$,'lease heartbeat works and stale worker is fenced');

select ok(to_regclass('public.push_delivery_outbox') is not null,'push outbox exists');
select ok(not has_table_privilege('authenticated','public.push_delivery_outbox','SELECT'),'push outbox is not browser-readable');
select ok(has_function_privilege('service_role','public.claim_push_delivery_batch(integer)','EXECUTE') and not has_function_privilege('authenticated','public.claim_push_delivery_batch(integer)','EXECUTE'),'push claims are service-only');

select lives_ok($outer$
do $test$
declare
  v_user uuid:='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  v1 uuid; v2 uuid; v_lock uuid; v_ok boolean;
begin
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_user,'authenticated','authenticated','push-test@example.invalid','{"provider":"google","providers":["google"]}','{}',now(),now());
  select public.enqueue_push_delivery_event('analysis-ready:test',v_user,'ANALYSIS_READY','{}') into v1;
  select public.enqueue_push_delivery_event('analysis-ready:test',v_user,'ANALYSIS_READY','{}') into v2;
  if v1 is distinct from v2 or (select count(*) from public.push_delivery_outbox where event_key='analysis-ready:test')<>1 then raise exception 'outbox idempotency failed'; end if;
  select lock_token into v_lock from public.claim_push_delivery_batch(5) where id=v1;
  if v_lock is null then raise exception 'outbox claim failed'; end if;
  select public.fail_push_delivery_event(v1,v_lock,'temporary',true,'{"resolvedSubscriptionIds":[]}') into v_ok;
  if not v_ok or not exists(select 1 from public.push_delivery_outbox where id=v1 and status='PENDING' and attempts=1 and next_attempt_at>now()) then raise exception 'retry backoff state failed'; end if;
end
$test$
$outer$,'push outbox is idempotent and retryable');

select ok(to_regclass('public.automation_runs') is not null,'automation outcome ledger exists');
select ok(not has_table_privilege('authenticated','public.automation_runs','SELECT'),'automation ledger is not browser-readable');
select ok(has_function_privilege('service_role','public.reconcile_automation_runs(integer)','EXECUTE') and not has_function_privilege('authenticated','public.reconcile_automation_runs(integer)','EXECUTE'),'automation reconciliation is service-only');
select ok(position('lease_expires_at' in pg_get_functiondef('public.kick_analysis_worker()'::regprocedure))>0,'worker recovery dispatch uses lease expiry');
select ok(position('automation_runs' in pg_get_functiondef('public.kick_analysis_worker()'::regprocedure))>0,'worker dispatch records automation request');
select ok(position('automation_runs' in pg_get_functiondef('public.kick_external_api_maintenance()'::regprocedure))>0,'maintenance dispatch records automation request');
select ok(position('automation_runs' in pg_get_functiondef('public.kick_push_delivery_dispatcher()'::regprocedure))>0,'push dispatch records automation request');
select ok(exists(select 1 from cron.job where jobname='push-delivery-dispatch' and active),'push recovery cron is active');
select ok(exists(select 1 from cron.job where jobname='automation-http-reconcile' and active),'automation response reconciliation cron is active');
select ok(exists(select 1 from public.app_schema_releases where version='20260912-integrations-automation-resilience'),'resilience release is registered');
select ok(has_function_privilege('service_role','public.acquire_external_api_slot(text,integer,integer)','EXECUTE'),'shared API rate primitive remains available to adapters');

select * from finish();
rollback;
''')

# -----------------------------------------------------------------------------
# Documentation: canonical governance + close-out audit
# -----------------------------------------------------------------------------
gov = read("docs/GOVERNANCE.md")
marker = "## Integration and automation resilience (2026-09-12)"
if marker not in gov:
    gov += r'''

## Integration and automation resilience (2026-09-12)

External integrations and scheduled jobs are governed as recoverable distributed work. FiveDollar transient failures use bounded retries through the shared provider rate budget; API-Football uses the same distributed cache/rate primitives as its fallback path. Background analysis uses renewable short leases, heartbeat and fenced state transitions. Analysis-ready notifications are durable outbox events rather than best-effort side effects. HTTP pg_cron/pg_net dispatches are recorded in `automation_runs` and reconciled against the pg_net response table so dispatch success is not confused with endpoint success. Football local-time interpretation is anchored to the IANA zone `America/Sao_Paulo`, including historical DST.
'''
    write("docs/GOVERNANCE.md", gov)

write("docs/INTEGRATIONS_AUTOMATION_AUDIT_2026-09-12.md", r'''# Integrations & Automations audit close-out — 2026-09-12

## Scope
Communication with external services, scheduled tasks, time zones, usage limits, retries after failures, duplicate-processing prevention, durable notifications, and automation outcome evidence.

## Closed findings

1. **FiveDollar transient failures** — bounded three-attempt retry for network/timeout and HTTP 408/425/500/502/503/504. Every attempt reacquires the distributed provider slot. HTTP 429 keeps Retry-After/shared blocking and is not busy-wait retried.
2. **Worker stale execution risk** — `analysis_jobs` now uses a 90-second lease token, 25-second heartbeat and fenced compare-and-set transitions. Expired workers cannot mark steps done/error after another worker owns the job.
3. **API-Football fallback coordination** — distributed cache and shared request window use the existing `external_api_cache`, `external_api_rate_state`, `acquire_external_api_slot` and `mark_external_api_rate_limited` primitives; in-process pacing remains the DB-outage fallback.
4. **Web Push one-shot delivery** — analysis completion now inserts the idempotent event `analysis-ready:<runId>` into `push_delivery_outbox`. A protected dispatcher claims bounded batches, uses a 10-second delivery timeout, exponential retry up to five attempts and removes 404/410 subscriptions.
5. **Hard-coded UTC-3 assumptions** — CSV kickoff and FiveDollar daily fixture windows use `America/Sao_Paulo` through `Intl`. Unit coverage includes a 2019 DST date (UTC-2) and a 2026 standard date (UTC-3).
6. **Cron dispatch vs endpoint success** — `automation_runs` records pg_net request IDs for analysis worker, FiveDollar maintenance and push dispatch. A reconciliation cron maps actual HTTP responses to `SUCCESS`, `FAILED` or `TIMEOUT` without persisting response bodies/secrets.

## Controls retained
- FiveDollar Pro operational guard stays below the provider limit.
- 429 shared block state remains cross-instance.
- Job creation/enqueue remains idempotent.
- Dispatch capability tokens remain server/database-only.
- New operational tables have RLS enabled and no direct browser privileges.
- Web Push remains auxiliary: a notification failure never changes the completed analysis result.

## Validation required before production close
The versioned migration must pass pgTAP, all Vitest suites and the production build. After merge, apply it to Lovable Cloud, verify live cron/function/table state, run a transactional lease/outbox smoke test, publish the project and inspect real `automation_runs` reconciliation. The audit is closed only after those production checks are recorded in the delivery summary.
''')

# Remove this one-shot mechanism from the final tree.
(ROOT / "scripts/apply-integrations-automation-hardening.py").unlink(missing_ok=True)
(ROOT / ".github/workflows/apply-integration-hardening.yml").unlink(missing_ok=True)
