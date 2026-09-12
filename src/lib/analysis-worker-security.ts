export const ANALYSIS_WORKER_MAX_BODY_BYTES = 1024;
export const ANALYSIS_WORKER_RATE_LIMIT = 60;
export const ANALYSIS_WORKER_RATE_WINDOW_MS = 60_000;
const MAX_RATE_BUCKETS = 2048;

type RateBucket = { count: number; resetAt: number };

function clientRateKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    forwarded ||
    "unknown";
  return candidate.slice(0, 128);
}

export function createFixedWindowRequestLimiter(options?: {
  limit?: number;
  windowMs?: number;
  maxBuckets?: number;
}) {
  const limit = options?.limit ?? ANALYSIS_WORKER_RATE_LIMIT;
  const windowMs = options?.windowMs ?? ANALYSIS_WORKER_RATE_WINDOW_MS;
  const maxBuckets = options?.maxBuckets ?? MAX_RATE_BUCKETS;
  const buckets = new Map<string, RateBucket>();

  function prune(now: number) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }

    while (buckets.size >= maxBuckets) {
      const oldest = buckets.keys().next().value as string | undefined;
      if (!oldest) break;
      buckets.delete(oldest);
    }
  }

  return (request: Request, now = Date.now()): Response | null => {
    const key = clientRateKey(request);
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size >= maxBuckets) prune(now);
      bucket = { count: 1, resetAt: now + windowMs };
      buckets.set(key, bucket);
      return null;
    }

    bucket.count += 1;
    if (bucket.count <= limit) return null;

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return Response.json(
      { status: "RATE_LIMITED" },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(retryAfterSeconds),
        },
      },
    );
  };
}

export async function readBoundedJsonObject(
  request: Request,
  maxBytes = ANALYSIS_WORKER_MAX_BODY_BYTES,
): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return null;

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) return null;
  }

  if (!request.body) return null;

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let raw = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
