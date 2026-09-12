import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, createCspNonce, injectCspNonce } from "./csp";

describe("strict CSP", () => {
  it("creates a fresh CSP-safe nonce", () => {
    const first = createCspNonce();
    const second = createCspNonce();
    expect(first).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(first).not.toBe(second);
  });

  it("builds script and style policies without unsafe-inline or unsafe-eval", () => {
    const policy = buildContentSecurityPolicy("0123456789abcdef0123456789abcdef");
    expect(policy).toContain("script-src 'self' 'nonce-0123456789abcdef0123456789abcdef'");
    expect(policy).toContain("style-src 'self' 'nonce-0123456789abcdef0123456789abcdef'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("style-src-attr 'none'");
    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("unsafe-eval");
  });

  it("adds the response nonce to framework-managed script and style tags", () => {
    const nonce = "0123456789abcdef0123456789abcdef";
    const html = '<html><head><style>body{margin:0}</style></head><body><script>window.__x=1</script><script src="/app.js"></script></body></html>';
    const result = injectCspNonce(html, nonce);

    expect(result).toContain(`<style nonce="${nonce}">`);
    expect(result).toContain(`<script nonce="${nonce}">window.__x=1</script>`);
    expect(result).toContain(`<script nonce="${nonce}" src="/app.js"></script>`);
  });

  it("does not replace an explicit nonce already present", () => {
    const html = '<script nonce="existing">ok()</script><style nonce="existing">body{}</style>';
    expect(injectCspNonce(html, "0123456789abcdef")).toBe(html);
  });
});
