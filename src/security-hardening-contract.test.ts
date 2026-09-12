import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("security hardening contracts", () => {
  it("keeps the 30-day boundary server-side instead of localStorage", () => {
    const authGate = source("src/components/AuthGate.tsx");
    const middleware = source("src/integrations/supabase/auth-middleware.ts");

    expect(authGate).not.toContain("bet-value-mobile-auth-at");
    expect(authGate).not.toContain("writeMobileAuthAt");
    expect(middleware).toContain("isAuthenticationFresh(claims)");
    expect(middleware).toContain("session_id");
  });

  it("keeps a second Web Push destination check at the server fetch boundary", () => {
    const pushServer = source("src/lib/push.server.ts");
    expect(pushServer).toContain("isTrustedPushEndpoint(subscription.endpoint)");
    expect(pushServer).toContain('redirect: "error"');
  });

  it("keeps the hardened CSP directives", () => {
    const server = source("src/server.ts");
    expect(server).toContain("base-uri 'none'");
    expect(server).toContain("script-src-attr 'none'");
    expect(server).toContain("object-src 'none'");
    expect(server).not.toContain("unsafe-eval");
  });
});
