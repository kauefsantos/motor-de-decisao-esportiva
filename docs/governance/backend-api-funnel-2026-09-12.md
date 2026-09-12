# Backend/API Funnel Hardening — 2026-09-12

## Scope

This change closes the backend/API audit findings and prepares the backend contract for the next frontend flow. Lovable Cloud is runtime/data truth; GitHub `main` remains the versioned source of truth for code, migrations, tests and business rules.

## New user-flow backend contract

The future frontend is expected to orchestrate these phases:

1. **Draft upload** — `createAnalysisDraft` stores an idempotent staging draft rather than immediately creating a final analysis.
2. **Validation** — `validateAnalysisDraft` validates syntax and resolves fixtures against 5Dollar. It returns an explicit `editable_fields` list for each invalid/ambiguous game. Only those fields are eligible for correction.
3. **Correction** — `correctAnalysisDraft` rejects any attempt to change a field that the backend did not mark editable.
4. **Finalize** — `finalizeAnalysisDraft` requires every draft game to be `VALID`, atomically creates run + upload metadata + matches, and atomically enqueues the background worker.
5. **Data/model processing** — the existing server-side pipeline collects, cleans and models the validated games.
6. **Real-price evaluation** — automatic/manual prices can be evaluated into the new decision queue. No candidate is called value without a real price for the exact supported contract.
7. **Decision queue** — `buildDecisionOpportunityQueue` persists all qualified, correlation-filtered opportunities sorted by EV/edge. `getNextDecisionBatch` exposes no more than 10 at once.
8. **User choice** — user can accept at most 3 selections per target date, every day of the week. Rejecting all currently shown options reveals the next qualified batch if one exists.
9. **Exhaustion** — when no `AVAILABLE` or `SHOWN` opportunities remain, backend returns `exhausted=true`; history remains queryable so the frontend can revisit prior batches.
10. **Stake** — accepted queue items become `PROPOSED` bankroll ledger rows. Existing atomic bankroll RPC remains authoritative for stake confirmation.

No artificial recommendation is generated to fill a batch of ten. A batch may contain 0–10 items.

## Backend audit corrections

### Atomic run creation

`create_analysis_run_atomic` creates `analysis_runs`, `uploaded_files` and `matches` in one PostgreSQL transaction. Any failure rolls back all three.

### Idempotency

`analysis_runs.idempotency_key` is unique per owner. New draft/finalization clients supply a UUID key. The legacy create endpoint derives a short-window deterministic key when an older client does not yet supply one, preventing double-click/network retry duplication without permanently blocking an intentional rerun.

### Atomic odds/result replacement

`replace_run_value_analysis_atomic` row-locks the run and replaces user odds, evaluations, final selections and run status in one transaction.

### Atomic enqueue

`enqueue_analysis_job_atomic` uses `INSERT ... ON CONFLICT DO NOTHING`; concurrent enqueue requests converge on the same `analysis_jobs.run_id` row and receive its state.

### Compare-and-set retry

`retry_analysis_job_atomic` only transitions `ERROR -> QUEUED`. It rotates `dispatch_token`, invalidating stale worker requests from the failed attempt.

### Daily selection quota

The database trigger now enforces **3 selections per owner + target date on every day**, across multiple runs for the same date. `PROPOSED`, `OPEN` and `SETTLED` consume slots; `DECLINED` releases one. An advisory transaction lock serializes selections across different runs for the same owner/date.

### Stable error contract

New/public HTTP routes use `ok`, `data` or `error { code, message }`, plus `requestId`. Raw PostgreSQL/upstream errors stay in server logs. New server functions use typed public errors instead of returning provider/database messages directly.

## 5Dollar API optimizations

### 1. Global rate limiting

`acquire_external_api_slot` stores the rate window in Lovable Cloud. All server instances share the same 9-request/minute operational cap, keeping one request of margin below the documented Pro 10/minute cap. The previous in-memory limiter remains only as a database-failure fallback.

HTTP 429 responses call `mark_external_api_rate_limited`, persisting the provider `blocked_until` across server instances.

### 2. Distributed cache

Successful 5Dollar GET payloads are cached in `external_api_cache`, shared across instances and cold starts. A small in-process cache is retained as L1; Lovable Cloud is L2/shared cache. Expired rows are cleaned by maintenance.

### 3. Provider `/status` observability

`fiveDollarApiStatus` calls `/v1/status` with a 10-minute cache and persists the provider plan/limit payload to `external_api_status_snapshots`. The backend no longer needs to rely only on a hard-coded plan assumption for observability.

### 4. Standings prewarm

A protected daily maintenance route is dispatched by pg_cron. It checks `/status`, discovers leagues relevant to current/next analysis dates, and prewarms missing corner/card standings for up to three leagues per pass. Status + at most six standings calls remain within the 9/min operational envelope.

### 5. Rich historical research payloads

League-history requests now include `events,stats`, matching the existing team-history path. Existing parsing persists shots, possession, attacks, first-half metrics and early-event features as **research-only** observations. They remain `contractCompatible=false` and do not change model prices until a separate out-of-sample/walk-forward validation explicitly approves a feature.

### 6. Capability/plan gates

`external_api_capabilities` records six current decisions:

- fixtures window: enabled / Pro;
- Bet365 opening/closing snapshots: enabled / Pro;
- events+stats: enabled for research only / Pro;
- corner/card standings: enabled / Pro;
- BTTS price: technically available but disabled until business/model validation;
- full tick odds history: disabled because it requires Ultra.

The optimization goal is maximum useful value from the current plan, not blindly enabling every market exposed by the upstream API.

## Concurrency invariants

- Two create requests with the same idempotency key resolve to one run.
- Two enqueue requests resolve to one job.
- Only one retry can consume an `ERROR` state.
- Worker claims remain atomic.
- Bankroll confirmation and settlement remain atomic and serialized.
- Queue acceptance is serialized by owner/date; a fourth accepted choice is rejected.
- Declining a bet during stake confirmation synchronizes its queue row to `DECLINED` and releases the daily slot.

## Frontend status

This change intentionally implements the backend contract only. The existing UI is not redesigned here. The next frontend can use the staged validation/queue functions without weakening the backend invariants.
