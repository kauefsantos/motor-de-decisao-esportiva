const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function createCspNonce(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function buildContentSecurityPolicy(nonce: string): string {
  if (!NONCE_RE.test(nonce)) throw new Error("Invalid CSP nonce");

  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'self' https://*.lovable.dev https://*.gptengineer.app",
    `script-src 'self' 'nonce-${nonce}'`,
    "script-src-attr 'none'",
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.lovable.dev https://*.gptengineer.app",
    "form-action 'self' https://accounts.google.com",
    "frame-src 'self' https://accounts.google.com https://*.lovable.dev https://*.gptengineer.app",
  ].join("; ");
}

export function injectCspNonce(html: string, nonce: string): string {
  if (!NONCE_RE.test(nonce)) throw new Error("Invalid CSP nonce");
  const escaped = nonce.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

  return html
    .replace(/<script\b(?![^>]*\bnonce\s*=)/gi, `<script nonce="${escaped}"`)
    .replace(/<style\b(?![^>]*\bnonce\s*=)/gi, `<style nonce="${escaped}"`);
}
