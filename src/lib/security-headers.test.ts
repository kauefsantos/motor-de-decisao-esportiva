import { describe, expect, it } from "vitest";

import { redactSensitiveText } from "./redaction";
import { contentSecurityPolicy, withSecurityHeaders } from "./security-headers";

describe("security headers", () => {
  it("blocks framing outside Lovable preview", () => {
    const request = new Request("https://bet.example.com/");
    const csp = contentSecurityPolicy(request);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("allows the trusted Lovable editor to frame a preview", () => {
    const request = new Request(
      "https://id-preview--28664075-8af4-4155-9ee9-8ed86021681a.lovable.app/",
    );
    const csp = contentSecurityPolicy(request);
    expect(csp).toContain("https://lovable.dev");
    expect(csp).toContain("'unsafe-eval'");
  });

  it("sets the baseline response protections", () => {
    const request = new Request("https://bet.example.com/");
    const response = withSecurityHeaders(new Response("ok"), request);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
  });
});

describe("credential redaction", () => {
  it("removes bearer, JWT and Supabase-style keys", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature";
    const input = `Authorization: Bearer ${jwt} apikey=sb_secret_example123`;
    const output = redactSensitiveText(input);
    expect(output).not.toContain(jwt);
    expect(output).not.toContain("sb_secret_example123");
    expect(output).toContain("[REDACTED]");
  });
});
