# Frontend integrations & backend-flow audit — 2026-09-12

## Scope

Frontend behavior related to external services, background/scheduled work, time zones, provider usage limits, retries after failures, duplicate-processing prevention, and synchronization with the current backend decision funnel.

Runtime note: GitHub `main` is the versioned-code source of truth; Lovable Cloud is the runtime/database source of truth. This audit can validate the repository contract and CI after the PR is opened, but live cron/function/table state still requires a Lovable Cloud production smoke test after deployment.

## Executive conclusion

The frontend on `main` was **not yet synchronized** with the backend flow introduced on 2026-09-12. The backend already supported staged CSV validation and a persistent ranked decision queue, while the UI still created runs directly and used the legacy experimental odds/result flow.

This branch aligns the user flow with the backend invariants:

`CSV -> idempotent draft -> provider validation -> controlled correction -> atomic finalize/enqueue -> background processing -> real odds -> persistent decision queue -> accept/decline up to 3 per target date -> finalize -> stake`

## Findings and corrections

| ID | Finding | Severity / priority | Evidence / reproduction on previous frontend | Correction in this branch | Expected post-fix behavior |
| --- | --- | --- | --- | --- | --- |
| FE-01 | Upload bypassed the new staged backend contract and directly created/enqueued a run. | High / P0 | Upload a syntactically valid CSV. `src/routes/index.tsx` called `createRun` then `enqueueAnalysis`; there was no server-side fixture validation/correction screen. | Upload now calls `createAnalysisDraft` with a stable per-file `clientRequestId`, then routes to `/draft/$draftId/validacao`. | A run is not created until every draft game is valid. Repeated submission of the same draft request converges on the idempotent backend draft. |
| FE-02 | Backend-controlled `editable_fields` were not represented in the UI. | High / P0 | Ambiguous/wrong fixture data could not be corrected through the new contract because the frontend never called `validateAnalysisDraft` or `correctAnalysisDraft`. | New validation route loads/validates the draft and renders inputs only for fields explicitly marked editable by the backend. | The browser cannot present unrelated fields as editable; finalization remains blocked until the backend returns `READY`. |
| FE-03 | Business rule mismatch: UI used 2 selections on weekdays and 3 on weekends, while backend now enforces 3 per owner + target date every day. | High / P0 | Legacy `selectionLimitForDate` returned 2 Monday-Friday and 3 Saturday/Sunday. | Active opportunities UI reads `dailySelectionLimit` from the backend and falls back only to the canonical value `3`. | UI and database both enforce the same daily ceiling; no weekday/weekend divergence. |
| FE-04 | New persistent decision queue was bypassed by the active UI. Results were partly coordinated through browser `localStorage`. | High / P0 | The old opportunities component called `analyzeExperimentalMarketsOddsPersisted`, selected directly, serialized an experimental result to `localStorage`, then navigated to results. | Active route now uses `DecisionQueueFlow`: `buildDecisionOpportunityQueue`, `getDecisionQueueHistory`, `getNextDecisionBatch`, atomic accept/decline, and `finalizeDecisionSelection`. | Batches contain 0-10 genuine qualified options, ordered server-side; history and accepted choices are server-authoritative. |
| FE-05 | Zero-qualified-result UX could look like the user had returned to odds entry. | Medium / P1 | A queue build returning zero rows leaves no queue rows for history to render. | The active component keeps the completed empty-build message visible and explicitly states that no artificial suggestion is created. | User sees a terminal “no option passed all criteria” state instead of an apparently reset workflow. |
| FE-06 | Staged draft validation hard-coded UTC-3 despite the project-wide `America/Sao_Paulo` policy. | Medium / P1 | `kickoff()` returned an ISO string ending `-03:00`; historical Brazilian DST dates can be UTC-2. | Draft validation now uses `saoPauloLocalDateTimeToIso`, the existing Intl-based `America/Sao_Paulo` utility. | Historical DST and current standard-time dates resolve to the correct UTC instant. |
| FE-07 | Browser behavior could accidentally duplicate provider calls if effects were allowed to restart freely. | Medium / P1 | Automatic odds are initiated from the opportunities screen. Repeated mounts/retries can otherwise amplify provider usage. | Active component keeps a per-run start guard and delegates retry/rate/cache behavior to the server. Manual retry is user-driven. | Frontend does not implement its own busy retry loop; provider limits/retry policy remain centralized server-side. |
| FE-08 | Processing reload safety needed to remain idempotent with the hardened worker contract. | Low / P2 | `/processamento` calls enqueue on direct/reloaded visits. | Existing behavior retained intentionally because backend enqueue is atomic/idempotent; UI retry uses the server retry transition. | Reloading the processing screen does not create a second job; retry is accepted only from the server-authorized failed state. |

## External-service and automation contract validated in code

- FiveDollar retry/rate/cache policy remains server-side. The frontend does not contain a competing timer or provider-rate algorithm.
- Automatic price lookup is a single frontend orchestration action per run; bounded upstream retries are performed by the server adapter.
- Scheduled maintenance, worker dispatch and push dispatch remain server/database responsibilities; the browser does not pretend a cron dispatch means endpoint success.
- Processing UI continues polling read-only status and can safely be closed/reopened because the worker is server-side.
- Push notification setup remains best-effort and never determines whether an analysis is considered complete.
- Decision acceptance/finalization is server-authoritative and serialized by the existing database functions.

## Regression coverage added

- `src/frontend-backend-flow-sync.test.ts`
  - upload starts with `createAnalysisDraft`, not legacy direct create/enqueue;
  - validation/correction/finalization functions are wired into the validation route;
  - opportunities route uses `DecisionQueueFlow`, not `ExperimentalMarketsPilot`;
  - active queue flow has no `localStorage` dependency or weekday/weekend limit helper;
  - draft validation contains no hard-coded `:00-03:00` offset.
- `src/sao-paulo-time.test.ts`
  - validates a historical 2019 DST date at UTC-2;
  - validates a 2026 standard-time date at UTC-3.

## Improvements recommended after merge

1. Treat the server-backed result view as the primary result presentation everywhere and gradually remove the detached legacy `ExperimentalMarketsPilot`/browser-result path once no callers/tests depend on it.
2. Surface stable backend error codes and request IDs in a collapsible diagnostic detail so support can distinguish `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`, `CONFLICT` and generic failures without exposing raw provider/database errors.
3. Add a read-only operational status card for authorized diagnostics showing last successful worker/maintenance/push reconciliation, provider status age, and whether the latest run is using cached data. Do not expose secrets or internal dispatch tokens.
4. Add browser E2E coverage for: ambiguous fixture correction, double-click finalization, reload during processing, 429/upstream-unavailable messaging, ten-item decision batches, decline-to-next-batch, fourth-choice rejection, zero-qualified state, and final stake handoff.
5. After deployment, record a Lovable Cloud smoke test proving the versioned migration, cron state, live functions, `automation_runs` reconciliation, lease recovery, outbox delivery, and real provider behavior.

## Validation boundary

### Validated from repository/versioned code

- Frontend-to-backend function wiring and route registration.
- Staged draft/correction/finalization contract.
- Daily selection-limit synchronization.
- Decision queue/history/accept/decline/finalize wiring.
- Frontend avoidance of autonomous provider retry loops.
- `America/Sao_Paulo` conversion wiring and regression tests.
- Existing CI definition includes database tests, functional E2E, experimental E2E, unit tests and production build.

### Not yet validated from this environment

- Actual Lovable Cloud schema/migrations applied in production.
- Live pg_cron schedule and `automation_runs` reconciliation after deployment.
- Live FiveDollar/API-Football plan headers, 429 behavior and real provider latency.
- Live Web Push outbox delivery on real browser subscriptions.
- Full browser E2E against the published Lovable URL.
- PR CI result until the branch is submitted and GitHub Actions finishes.

These production checks are required before calling the deployed runtime fully closed; repository-level synchronization can be closed once CI is green.
