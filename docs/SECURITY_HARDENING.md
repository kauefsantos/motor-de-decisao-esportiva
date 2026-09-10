# Security hardening baseline

## Trust model

This application is intentionally private and single-user.

- Authentication is Google-only.
- Server functions validate the Supabase JWT, the approved email and `app_metadata.provider = google`.
- The database independently enforces the same Google identity at `auth.users` through a trigger.
- Application data in `public` is service-only: browser roles have no direct table/view grants and RLS remains enabled on every public table.
- `SUPABASE_SERVICE_ROLE_KEY` and `FIVE_DOLLAR_FOOTBALL_API_KEY` remain server-side environment credentials.

The browser's authenticated session is therefore an authentication credential for calling protected server functions, not a direct data-plane permission to the application tables.

## HTTP surface

The legacy `/api/elo-sync` route was removed. Elo daily maintenance is performed by PostgreSQL `pg_cron` jobs that call the database functions directly. No public HTTP endpoint is required to seed the 5Dollar key or trigger Elo synchronization.

All normal application mutations use `createServerFn` and inherit the global auth + CSRF middleware.

## Database privileges and RLS

The hardening migration revokes `public`, `anon` and `authenticated` access to application relations, sequences and public RPCs, while retaining service-role access. This is deliberate defense in depth: even if a future browser RLS policy is added accidentally, there is no table grant to combine with it unless a later migration explicitly reopens that surface.

New public tables must:

1. enable RLS immediately;
2. default to no browser policy;
3. receive browser grants only after a separate security review;
4. avoid browser-executable `SECURITY DEFINER` functions.

## Atomic writes and concurrency

Critical multi-write flows are committed at the database boundary:

- creation of an analysis run, upload metadata and matches;
- replacement of Motor 2 user odds, value evaluations, final selections and completion status.

Bankroll and manual-selection concurrency are additionally protected by database constraints, state-transition triggers and advisory transaction locks. These guards remain authoritative even if two browser tabs issue requests at nearly the same time.

## Bankroll rule

The operational minimum stake is **R$ 0,50**.

If the mathematical positive stake is below R$ 0,50, the recommendation is lifted to R$ 0,50 provided that:

- at least R$ 0,50 is available in the bankroll; and
- the resulting stake is permitted by the operational cap.

The operational maximum is the available bankroll capped by the larger of R$ 0,50 or the configured `max_stake_pct` amount. Fractional Kelly remains part of the mathematical sizing; the R$ 0,50 floor is the explicit execution rule approved for the experiment.

The database refuses `OPEN` or `SETTLED` tracking rows below R$ 0,50.

## External API rate limiting

The 5Dollar adapter reserves a slot through PostgreSQL before every uncached external request. The coordinator uses a shared fixed one-minute window and an advisory lock, so multiple application instances observe the same conservative ceiling of 9 requests/minute.

If the database coordinator is unavailable or returns an invalid state, the adapter fails closed and does not intentionally send the external request. The existing upstream `429` and `Retry-After` handling remains active.

## Browser and response hardening

Server responses receive:

- Content-Security-Policy;
- Referrer-Policy;
- Permissions-Policy;
- X-Content-Type-Options;
- Cross-Origin-Opener-Policy;
- X-Permitted-Cross-Domain-Policies.

Production framing is denied by CSP. Lovable preview hosts receive a narrowly scoped `frame-ancestors` exception for the trusted Lovable/GPT Engineer editor and may use `unsafe-eval` only because the preview/dev toolchain can require it.

The app does not use `dangerouslySetInnerHTML`; the CI security regression script prevents introducing it unnoticed.

## Session storage

Supabase browser sessions remain persistent so the private dashboard is usable across navigation/reloads. On a Lovable framed preview the dedicated broker validates the editor origin before exchanging session values. Outside that broker, Supabase persistence uses browser storage.

This means XSS prevention remains important because browser-readable storage increases the impact of a hypothetical XSS. The CSP, React escaping, prohibition of `dangerouslySetInnerHTML`, constrained dependencies and telemetry redaction provide defense in depth. A future move to an HttpOnly-cookie/BFF session model should be treated as a separate architecture migration, not mixed into routine UI changes.

## Logging and telemetry

Server error expansion and Lovable client telemetry redact:

- Bearer credentials and JWT-shaped values;
- Supabase publishable/secret key-shaped values;
- authorization/apikey/API-key/access-token/refresh-token assignments;
- known service-role, 5Dollar and cron secret field names.

Never intentionally log request `Authorization` headers, environment secrets or raw auth sessions.

## CI and repository governance

CI runs static security checks, lint, TypeScript typecheck, the experimental E2E test, the full unit suite, a production build, and a visitor SSR/security-header smoke test.

The desired GitHub governance is: protect `main`, require the CI job to pass before merge, prevent force pushes/deletion, and prefer pull requests for changes. Repository branch protection is an account-level GitHub setting and must be enabled through GitHub administration when an authorized administration surface is available.

## Auth signup closure

Once the approved Google identity exists, new Auth signups should be disabled in Supabase/Lovable configuration while Google login for the existing user remains active and email/password remains disabled. The database trigger already rejects any other identity, so disabling signup is an additional outer-layer control rather than the only authorization boundary.
