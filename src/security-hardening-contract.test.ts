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

  it("keeps a nonce-based CSP without unsafe inline execution", () => {
    const server = source("src/server.ts");
    const csp = source("src/lib/csp.ts");

    expect(server).toContain("buildContentSecurityPolicy(nonce)");
    expect(server).toContain("injectCspNonce(await response.text(), nonce)");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("style-src-attr 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("'nonce-${nonce}'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("uses the Lovable Cloud managed Google OAuth flow", () => {
    const authGate = source("src/components/AuthGate.tsx");
    const packageJson = source("package.json");

    // As credenciais Google gerenciadas ficam no broker do Lovable Cloud; chamar
    // supabase.auth.signInWithOAuth diretamente retorna "missing OAuth secret".
    expect(authGate).toContain('lovable.auth.signInWithOAuth("google"');
    expect(authGate).toContain('extraParams: { prompt: "select_account" }');
    expect(authGate).not.toContain("supabase.auth.signInWithOAuth");
    expect(packageJson).toContain("@lovable.dev/cloud-auth-js");
  });

  it("keeps the approved identity in the database instead of source literals", () => {
    const middleware = source("src/integrations/supabase/auth-middleware.ts");
    const initialAuthMigration = source(
      "supabase/migrations/20260911120500_reconcile_single_google_user_auth.sql",
    );
    const ownerMigration = source(
      "supabase/migrations/20260911235100_owner_defaults_and_push_guard.sql",
    );
    const closureMigration = source(
      "supabase/migrations/20260912012500_remove_public_authorized_identity.sql",
    );

    expect(middleware).not.toContain("ALLOWED_EMAIL");
    expect(middleware).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(middleware).toContain("is_approved_app_user");
    expect(initialAuthMigration).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(ownerMigration).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(closureMigration).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(closureMigration).toContain("public.is_approved_app_user");
  });
});
