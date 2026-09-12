# Security hardening follow-up — 2026-09-11

## Scope

Follow-up to `docs/SECURITY_AUDIT_2026-09-10.md`, focused on security-sensitive changes that landed after that audit: mobile session persistence, background analysis/Web Push, dependency scanning and CSP hardening.

Reference baseline: OWASP ASVS 5.0.0.

## Closed findings

### Absolute session lifetime

The browser-local `bet-value-mobile-auth-at` timestamp was removed. It could be deleted or rewritten by the user and therefore could not enforce a security boundary.

The global server authentication middleware now:

- verifies the Supabase JWT as before;
- requires a signed `session_id` claim;
- derives the original Google/OAuth authentication time from the signed `amr` claim;
- ignores `token_refresh` entries when calculating session age;
- rejects server-function access after 30 days;
- fails closed when a signed OAuth authentication timestamp is unavailable.

`AuthGate` mirrors the same policy only for UX and signs the browser out when the absolute lifetime is exceeded. The server remains authoritative.

### Web Push SSRF

Push subscription endpoints are no longer arbitrary URLs.

New subscriptions must be HTTPS endpoints owned by the supported Web Push providers (Apple Web Push, Firebase Cloud Messaging or Mozilla Push Service), without credentials or non-standard ports.

Before every outbound push request, the server repeats the trust check. Historical/untrusted subscription rows are removed instead of fetched. Fetch redirects are disabled so a trusted provider URL cannot redirect the server to an untrusted destination.

### CSP hardening

The response CSP now includes:

- `base-uri 'none'`;
- `script-src-attr 'none'`;
- `worker-src 'self'`;
- `manifest-src 'self'`;
- existing `object-src 'none'` and no `unsafe-eval`.

Framework-managed `unsafe-inline` remains temporarily in `script-src`/`style-src` for the current TanStack/Lovable hydration and OAuth path. Replacing it with nonce/hash CSP is a separate runtime migration, not a safe textual removal.

### Supply chain and secret scanning

The immediately preceding hardening on `main` already added:

- `bun audit --audit-level=high` to CI;
- full-history Gitleaks scanning;
- pinned scanner image/action boundaries;
- remediation of the high-severity transitive dependency findings detected at that time.

This follow-up preserves those controls.

## Regression coverage

Added tests cover:

- fresh versus expired OAuth authentication timestamps;
- token refresh not restarting the 30-day absolute lifetime;
- rejection when no signed OAuth authentication timestamp exists;
- trusted Web Push provider endpoints;
- localhost, loopback, link-local, private-network, lookalike-domain, credentialed and non-standard-port SSRF attempts;
- server-side push revalidation/redirect blocking contract;
- hardened CSP contract;
- removal of the mutable browser session timer.

## Residual maintenance items

1. `@lovable.dev/cloud-auth-js` remains a legacy/deprecated broker dependency. It is intentionally not replaced in this hardening because the live Google OAuth path depends on Lovable-managed runtime configuration; migrate it in an isolated auth change with preview and production login validation.
2. `unsafe-inline` remains for framework compatibility. A nonce/hash CSP should be evaluated separately with end-to-end hydration/OAuth validation.
3. The approved Google e-mail remains visible in historical repository commits and versioned database migrations. Removing the current literal would not remove historical disclosure and moving the allowlist to a server-only configuration requires coordinated Lovable Cloud provisioning. It is not treated as a credential.

## Acceptance criteria

The change is considered ready only when the pull-request CI passes dependency audit, secret scan, server-secret boundary checks, E2E tests, full Vitest suite and production build. The production smoke is also extended to require the new CSP directives after publication.
