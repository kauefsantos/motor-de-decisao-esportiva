# Integrations & Automations audit close-out — 2026-09-12

## Scope
Communication with external services, scheduled tasks, time zones, usage limits, retries after failures, duplicate-processing prevention, durable notifications, and automation outcome evidence.

## Closed findings

1. **FiveDollar transient failures** — bounded three-attempt retry for network/timeout and HTTP 408/425/500/502/503/504. Every attempt reacquires the distributed provider slot. HTTP 429 keeps Retry-After/shared blocking and is not busy-wait retried.
2. **Worker stale execution risk** — `analysis_jobs` now uses a 90-second lease token, 25-second heartbeat and fenced compare-and-set transitions. Expired workers cannot mark steps done/error after another worker owns the job.
3. **API-Football fallback coordination** — distributed cache and shared request window use the existing `external_api_cache`, `external_api_rate_state`, `acquire_external_api_slot` and `mark_external_api_rate_limited` primitives; in-process pacing remains the DB-outage fallback.
4. **Web Push one-shot delivery** — analysis completion now inserts the idempotent event `analysis-ready:<runId>` into `push_delivery_outbox`. A protected dispatcher claims bounded batches, uses a 10-second delivery timeout, exponential retry up to five attempts and removes 404/410 subscriptions.
5. **Hard-coded UTC-3 assumptions** — CSV kickoff and FiveDollar daily fixture windows use `America/Sao_Paulo` through `Intl`. Unit coverage includes a 2019 DST date (UTC-2) and a 2026 standard date (UTC-3).
6. **Cron dispatch vs endpoint success** — `automation_runs` records pg_net request IDs for analysis worker, FiveDollar maintenance and push dispatch. A reconciliation cron maps actual HTTP responses to `SUCCESS`, `FAILED` or `TIMEOUT` without persisting response bodies/secrets.

## Controls retained
- FiveDollar Pro operational guard stays below the provider limit.
- 429 shared block state remains cross-instance.
- Job creation/enqueue remains idempotent.
- Dispatch capability tokens remain server/database-only.
- New operational tables have RLS enabled and no direct browser privileges.
- Web Push remains auxiliary: a notification failure never changes the completed analysis result.

## Validation required before production close
The versioned migration must pass pgTAP, all Vitest suites and the production build. After merge, apply it to Lovable Cloud, verify live cron/function/table state, run a transactional lease/outbox smoke test, publish the project and inspect real `automation_runs` reconciliation. The audit is closed only after those production checks are recorded in the delivery summary.
