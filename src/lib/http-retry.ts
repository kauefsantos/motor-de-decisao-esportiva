export const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 500, 502, 503, 504]);

export function isTransientHttpStatus(status: number) {
  return TRANSIENT_HTTP_STATUSES.has(status);
}

export function retryDelayMs(attempt: number, random: () => number = Math.random) {
  const boundedAttempt = Math.max(1, Math.min(attempt, 6));
  const base = 350 * 2 ** (boundedAttempt - 1);
  const jitter = Math.floor(Math.max(0, Math.min(1, random())) * 180);
  return Math.min(5_000, base + jitter);
}
