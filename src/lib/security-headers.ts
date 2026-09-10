const PREVIEW_HOST_PATTERNS = [
  /^id-preview(?:-[a-z0-9]+)?--/i,
  /\.lovableproject(?:-dev)?\.com$/i,
  /\.gpt-eng\.com$/i,
  /\.gptengineer\.run$/i,
];

function isLovablePreview(hostname: string) {
  return PREVIEW_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

export function contentSecurityPolicy(request: Request): string {
  const hostname = new URL(request.url).hostname;
  const preview = isLovablePreview(hostname);
  const scriptSrc = ["'self'", "'unsafe-inline'", ...(preview ? ["'unsafe-eval'"] : [])];
  const frameAncestors = preview
    ? ["'self'", "https://lovable.dev", "https://*.lovable.dev", "https://gptengineer.app", "https://*.gptengineer.app"]
    : ["'none'"];

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://lovable.dev https://*.lovable.dev https://*.lovable.app",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com",
    `frame-ancestors ${frameAncestors.join(" ")}`,
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function withSecurityHeaders(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", contentSecurityPolicy(request));
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
