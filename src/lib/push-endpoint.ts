const MOZILLA_PUSH_HOST = /^(?:[a-z0-9-]+\.)*push(?:-[a-z0-9-]+)?\.services\.mozilla\.com$/i;

function isTrustedPushHost(hostname: string) {
  const host = hostname.toLowerCase();
  return (
    host === "web.push.apple.com" ||
    host === "fcm.googleapis.com" ||
    MOZILLA_PUSH_HOST.test(host)
  );
}

/**
 * Web Push subscriptions are server-side fetch destinations, so they must never
 * be treated as arbitrary URLs. Only provider-owned HTTPS endpoints on the
 * standard TLS port are accepted. This is the SSRF boundary for subscriptions.
 */
export function isTrustedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    if (url.port && url.port !== "443") return false;
    if (!isTrustedPushHost(url.hostname)) return false;
    return url.pathname.length > 1;
  } catch {
    return false;
  }
}
