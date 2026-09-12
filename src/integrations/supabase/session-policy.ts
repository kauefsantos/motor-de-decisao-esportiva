export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const CLOCK_SKEW_SECONDS = 5 * 60;

const PRIMARY_AUTH_METHODS = new Set([
  "oauth",
  "oauth_provider/authorization_code",
]);

type AmrEntry = {
  method?: unknown;
  timestamp?: unknown;
};

/**
 * Returns the original OAuth authentication time carried in the signed Supabase
 * JWT. Token refresh entries are deliberately ignored so refreshing an access
 * token cannot restart the application's 30-day absolute session lifetime.
 */
export function authenticationTimestampFromClaims(
  claims: Record<string, unknown>,
): number | null {
  const amr = claims["amr"];
  if (!Array.isArray(amr)) return null;

  const timestamps = amr
    .map((entry) => entry as AmrEntry)
    .filter(
      (entry) =>
        typeof entry?.method === "string" &&
        PRIMARY_AUTH_METHODS.has(entry.method) &&
        typeof entry.timestamp === "number" &&
        Number.isFinite(entry.timestamp),
    )
    .map((entry) => Math.floor(entry.timestamp as number))
    .filter((timestamp) => timestamp > 0);

  return timestamps.length > 0 ? Math.min(...timestamps) : null;
}

export function isAuthenticationFresh(
  claims: Record<string, unknown>,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const authenticatedAt = authenticationTimestampFromClaims(claims);
  if (authenticatedAt === null) return false;

  if (authenticatedAt > nowSeconds + CLOCK_SKEW_SECONDS) return false;
  return nowSeconds - authenticatedAt < SESSION_MAX_AGE_SECONDS;
}
