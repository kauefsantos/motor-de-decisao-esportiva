# Application Security Audit — 2026-09-10

## Scope and source of truth

This audit covers application security only: authentication and authorization boundaries, server-only secrets, privileged database access, cron/API routes, CSRF, response security headers, error handling, sensitive state transitions, CI permissions and dependency maintenance.

- Lovable Cloud is the source of truth for the live runtime/database environment.
- GitHub `main` is the source of truth for versioned application code, migrations, tests and workflows.
- RLS is documented separately in `docs/RLS_SECURITY.md`.

## Access model

The application is intentionally private and single-user.

- Browser login uses Google OAuth.
- `AuthGate` is UX only; authorization does not rely on the browser gate.
- Every TanStack `serverFn` is covered by the global server middleware in `src/start.ts`.
- Server authorization validates the Supabase token, requires the allowlisted e-mail and requires the Google provider.
- The current model must not be extended to a second user without redesigning ownership/tenant authorization and RLS.

## Privileged database boundary

`SUPABASE_SERVICE_ROLE_KEY` is server-only and may only be read in `src/integrations/supabase/client.server.ts`.

Privileged client imports from files that may enter a browser graph are dynamic imports executed inside trusted server handlers. CI now fails if:

1. `SUPABASE_SERVICE_ROLE_KEY` appears anywhere else under `src/`; or
2. a non-`*.server.ts` source file statically imports the service-role client.

This protects against accidental bundling/exposure regressions.

## Cron / administrative HTTP surface

`/api/elo-sync` is a protected fallback endpoint only.

- `GET` is side-effect free and returns `405 Method Not Allowed`.
- `POST` requires `Authorization: Bearer <LOVABLE_CRON_SECRET>`.
- Secret comparison hashes both values and uses `timingSafeEqual`.
- `LOVABLE_CRON_SECRET_PREVIOUS` supports controlled rotation.
- Sync implementation is dynamically imported only after authentication.
- Internal errors are logged server-side while the HTTP response remains generic.

The primary live Elo jobs continue to run inside PostgreSQL/pg_cron.

## CSRF and request authentication

TanStack server functions use the global Supabase bearer-token middleware and TanStack CSRF middleware. State-changing server functions use explicit input validators (Zod) for their externally supplied payloads.

## Response hardening

`src/server.ts` applies security headers to normal responses and recovered error responses:

- `Content-Security-Policy`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy` disabling camera, microphone, geolocation, payment, USB and browsing topics
- `Cross-Origin-Opener-Policy: same-origin-allow-popups`
- `Cross-Origin-Resource-Policy: same-origin`
- `X-Robots-Tag: noindex, nofollow, noarchive`
- `Cache-Control: private, no-store` for HTML/JSON
- HSTS on HTTPS

The CSP now defines `default-src`, script/style/image/font/connect/form/frame sources, blocks objects and restricts embedding. `unsafe-eval` is not allowed. `unsafe-inline` remains enabled for scripts/styles for compatibility with the current TanStack/Lovable rendering path; moving to nonce/hash-based CSP is future hardening and requires separate runtime validation.

## Sensitive state integrity

Confirmation, rejection and settlement of experimental bets now use compare-and-set style updates:

- `PROPOSED -> DECLINED` requires the row still to be `PROPOSED` at update time.
- `PROPOSED -> OPEN` requires the row still to be `PROPOSED` at update time.
- `OPEN/PENDING -> SETTLED` requires the row still to be both `OPEN` and `PENDING` at update time.
- Each transition requires a row to be returned; otherwise the request fails as a concurrent/stale state change.

This prevents duplicate/stale writes against the same bet. Full serialization of the global bankroll across different bets remains a backend consistency concern rather than an authentication bypass and should be handled in the backend audit if multi-request concurrency becomes operationally relevant.

## Secrets and external APIs

- Real environment files are ignored by Git.
- `.env.example` contains placeholders only.
- Supabase publishable URL/key are public identifiers and may exist in the browser bundle.
- Supabase service-role, 5DollarFootball API key and cron secrets are server-only.
- The 5DollarFootball adapter reads its API key only from server environment variables and does not return the key to callers.

## Error handling and information disclosure

Catastrophic SSR failures are normalized into a generic error page. Detailed stack/cause information is retained only in server logs. The protected Elo endpoint also returns a generic failure message instead of raw exception details.

Server logs can still contain operational error messages and stack traces; production log access therefore remains a privileged operational boundary and should not be made public.

## XSS / dynamic code

No application use of `dangerouslySetInnerHTML`, `eval` or `new Function` was identified during this audit. React escaping remains the default rendering boundary. The CSP adds a second line of defense.

## CI and supply-chain posture

- GitHub Actions workflows use `contents: read` permissions.
- Critical actions are pinned to immutable commit SHAs.
- Dependency and GitHub Actions updates are monitored by Dependabot weekly.
- CI runs tests and a production build on pushes and pull requests to `main`.
- CI now includes the privileged-client/secret boundary check described above.
- Database/RLS regression tests remain in the separate database security workflow.

`@lovable.dev/cloud-auth-js` is officially described by its publisher as a legacy OAuth broker and the npm package is deprecated. The current integration is not treated as a confirmed exploitable vulnerability: server-side authorization still independently validates every `serverFn`. Migration away from this broker is maintenance debt and should be performed only as a separate OAuth change with preview and production login validation.

## Residual limitations / accepted risks

1. **Single-user architecture:** the e-mail allowlist is intentionally hard-coded server-side. Adding users requires an authorization redesign, not another e-mail condition.
2. **CSP compatibility:** nonce/hash-based CSP would be stronger than `unsafe-inline`, but is deferred because it can break framework hydration/OAuth without coordinated runtime changes.
3. **Deprecated Lovable OAuth broker:** maintenance debt; migrate separately rather than altering authentication during unrelated work.
4. **Global bankroll concurrency across different bets:** per-row duplicate transitions are protected; database-level serialization of the whole bankroll is left for the backend/integrity audit.
5. **Published Lovable snapshots:** a GitHub commit and a Lovable production publish are distinct states. Production smoke must be rerun after publication.

## Verdict

For the current private, single-user deployment, no confirmed critical or high-severity application-security vulnerability remains open in the audited paths after the hardening above.

Application Security audit status: **CLOSED**, subject to the explicit residual limitations above and successful CI/production smoke validation for the hardened commit.