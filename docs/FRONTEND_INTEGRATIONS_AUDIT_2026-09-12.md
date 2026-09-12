# Frontend integrations & backend-flow audit — 2026-09-12

## Scope

Frontend behavior related to external services, background/scheduled work, time zones, provider usage limits, retries after failures, duplicate-processing prevention, and synchronization with the current backend decision funnel.

Runtime note: GitHub `main` is the versioned-code source of truth; Lovable Cloud is the runtime/database source of truth. This audit validates the repository contract and CI, but live cron/function/table state still requires a Lovable Cloud production smoke test after deployment.

## Executive conclusion

The frontend on `main` was **not synchronized** with the backend flow integrated on 2026-09-12. The backend already supported staged CSV validation, idempotent finalization and a persistent ranked decision queue, while the active UI still created/enqueued runs directly and used the legacy experimental odds/result path.

This branch aligns the active user flow with the backend invariants:

`CSV -> idempotent draft -> provider validation -> controlled correction -> atomic finalize/enqueue -> background processing -> real odds -> persistent decision queue -> accept/decline up to 3 per target date -> finalize -> stake`

A persisted decision queue is now recovered **before** model preparation/automatic price collection, so reopening the opportunities page does not recalculate the experimental predictions or repeat external price calls for an already-started/finalized queue.

## Findings and corrections

| ID | Finding | Severity / priority | Evidence / reproduction on previous frontend | Correction in this branch | Expected post-fix behavior |
| --- | --- | --- | --- | --- | --- |
| FE-01 | Upload bypassed the new staged backend contract and directly created/enqueued a run. | High / P0 | Upload a syntactically valid CSV. `src/routes/index.tsx` called `createRun` then `enqueueAnalysis`; there was no server-side fixture validation/correction screen. | Upload now calls `createAnalysisDraft` with a stable per-file `clientRequestId`, then routes to `/draft/$draftId/validacao`. | A run is not created until every draft game is valid. Repeated submission of the same draft request converges on the idempotent backend draft. |
| FE-02 | Backend-controlled `editable_fields` were not represented in the UI. | High / P0 | Ambiguous/wrong fixture data could not be corrected through the new contract because the frontend never called `validateAnalysisDraft` or `correctAnalysisDraft`. | New validation route loads/validates the draft and renders inputs only for fields explicitly marked editable by the backend. | The browser cannot present unrelated fields as editable; finalization remains blocked until the backend returns `READY`. |
| FE-03 | Business rule mismatch: UI used 2 selections on weekdays and 3 on weekends, while backend now enforces 3 per owner + target date every day. | High / P0 | Legacy `selectionLimitForDate` returned 2 Monday-Friday and 3 Saturday/Sunday. | Active opportunities UI reads `dailySelectionLimit` from the backend and falls back only to the canonical value `3`; functional E2E now validates a 3-choice portfolio. | UI and database both enforce the same daily ceiling; no weekday/weekend divergence in the active flow. |
| FE-04 | New persistent decision queue was bypassed by the active UI. Results were partly coordinated through browser `localStorage`. | High / P0 | The old opportunities component called `analyzeExperimentalMarketsOddsPersisted`, selected directly, serialized an experimental result to `localStorage`, then navigated to results. | Active route now uses the server-backed decision queue: build, history, next batch, atomic accept/decline and finalization. | Batches contain 0-10 genuine qualified options, ordered server-side; history and accepted choices are server-authoritative. |
| FE-05 | Reopening an existing queue could remount preparation and re-run prediction preparation/automatic odds collection. | High / P0 | `prepareExperimentalMarketsRun` deletes and recreates experimental prediction rows. The initial queue component mounted preparation and history in parallel, so an already-started decision state could be exposed to redundant work on revisit. | New `DecisionQueueGate` loads `getDecisionQueueHistory` first. Existing or finalized queues are resumed by a history-only component; `DecisionQueueFlow` is mounted only when no persisted decision state exists. | Reopening an existing queue does not re-run model preparation or external price collection. |
| FE-06 | Zero-qualified-result UX could look like the user had returned to odds entry. | Medium / P1 | A queue build returning zero rows leaves no queue rows for history to render. | The active component keeps the completed empty-build message visible and explicitly states that no artificial suggestion is created. | During the current session, the user sees a terminal “no option passed all criteria” state instead of an apparently reset workflow. |
| FE-07 | Staged draft validation hard-coded UTC-3 despite the project-wide `America/Sao_Paulo` policy. | Medium / P1 | `kickoff()` returned an ISO string ending `-03:00`; historical Brazilian DST dates can be UTC-2. | Draft validation now uses the existing `saoPauloLocalDateTimeToIso` utility based on `America/Sao_Paulo`. | Historical DST and current standard-time dates resolve to the correct UTC instant. |
| FE-08 | Browser behavior could amplify provider calls if retries/effects were independently implemented client-side. | Medium / P1 | Automatic odds are initiated from the opportunities screen. Unbounded client retry would compete with backend cache/rate governance. | Active frontend performs one orchestration attempt per fresh run and delegates bounded retry, distributed limits, cache and `Retry-After` handling to the server. Explicit reload/retry is user-driven. | Provider retry/rate policy remains centralized server-side; the browser does not busy-retry 429/upstream failures. |
| FE-09 | Processing reload safety needed to remain idempotent with the hardened worker contract. | Low / P2 | `/processamento` calls enqueue on direct/reloaded visits. | Existing behavior retained intentionally because backend enqueue is atomic/idempotent; UI retry uses the server retry transition. | Reloading the processing screen does not create a second job; retry is accepted only from the server-authorized failed state. |
| FE-10 | Detached legacy experimental code still contains the obsolete weekday/weekend 2/3 helper. | Low / P2 | `experimental-markets-run.functions.ts` still exposes the old helper inside the detached legacy analysis path. | The active route no longer imports/calls the legacy pilot or legacy result analyzer, and regression tests fail if the active flow reintroduces `selectionLimitForDate`. | Current user journey follows the canonical limit of 3. Legacy code should be deleted after compatibility callers are confirmed absent. |

## External-service and automation contract validated in code

- FiveDollar retry/rate/cache policy remains server-side. The frontend does not contain a competing provider-rate algorithm.
- Automatic price lookup is initiated only for a fresh decision state; an existing persisted queue is recovered first.
- Bounded upstream retries are performed by the server adapter; the browser does not implement its own busy retry loop.
- Scheduled maintenance, worker dispatch and push dispatch remain server/database responsibilities; the browser does not treat a cron dispatch as proof of endpoint success.
- Processing UI continues polling read-only status and can safely be closed/reopened because the worker is server-side.
- Push notification setup remains best-effort and never determines whether an analysis is considered complete.
- Decision acceptance/finalization is server-authoritative and serialized by the existing database functions.

## Regression coverage

- `src/frontend-backend-flow-sync.test.ts`
  - upload starts with `createAnalysisDraft`, not legacy direct create/enqueue;
  - validation/correction/finalization functions are wired into the validation route;
  - opportunities route uses `DecisionQueueGate`, not `ExperimentalMarketsPilot`;
  - persisted history is checked before the fresh preparation flow is mounted;
  - active queue flow has no `localStorage` dependency or weekday/weekend limit helper;
  - draft validation contains no hard-coded `:00-03:00` offset.
- `src/frontend-ux-contract.test.ts`
  - active UX contract points to the new server-backed queue;
  - persisted queues are resumed without repeating model/external-price preparation;
  - query failures and zero-qualified results remain distinct states;
  - mobile odd entry remains touch-friendly.
- `src/functional-decision-flow.e2e.test.ts`
  - canonical daily portfolio limit is 3, with correlation limiting one selected market per match.
- Existing `src/lib/sao-paulo-time.test.ts`
  - validates current UTC-3 behavior without a fixed offset;
  - validates historical Brazilian DST at UTC-2 and the local-day Unix window.

## Remaining improvements

1. Remove the detached `ExperimentalMarketsPilot` and the obsolete legacy 2/3 helper after confirming no compatibility caller requires them. Keeping them detached is safe for the active route, but deletion removes future regression surface.
2. Persist a server-side marker such as `decision_queue_evaluated_at` even when the queue contains zero qualified rows. Today a zero-row result has no queue row to recover after a full page reload, so the current-session terminal state is explicit but a later revisit can legitimately re-evaluate prices.
3. Treat the server-backed result view as the primary result presentation everywhere and remove browser-result/local-storage compatibility code after migration.
4. Surface stable backend error codes and request IDs in a collapsible diagnostic detail so support can distinguish `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`, `CONFLICT` and generic failures without exposing provider/database internals.
5. Add a read-only operational status card for authorized diagnostics showing last successful worker/maintenance/push reconciliation, provider status age and whether the latest run used cached data.
6. Add browser E2E coverage for ambiguous fixture correction, double-click finalization, reload during processing, reload during a persisted queue, 429/upstream-unavailable messaging, ten-item batches, decline-to-next-batch, fourth-choice rejection, zero-qualified state and final stake handoff.
7. After deployment, record a Lovable Cloud smoke test proving the versioned migration, cron state, live functions, `automation_runs` reconciliation, lease recovery, outbox delivery and real provider behavior.

## Validation boundary

### Validated from repository/versioned code

- Frontend-to-backend function wiring and versioned route registration.
- Staged draft/correction/finalization contract.
- Daily selection-limit synchronization in the active flow.
- Decision queue/history/accept/decline/finalize wiring.
- Existing-queue recovery before prediction preparation/automatic price collection.
- Frontend avoidance of autonomous provider retry loops.
- `America/Sao_Paulo` conversion wiring and existing historical-DST regression coverage.
- CI definition includes dependency/security gates, database regression tests, functional E2E, experimental E2E, unit tests and production build.

### Not validated from this environment

- Actual Lovable Cloud schema/migrations applied in production.
- Live pg_cron schedule and `automation_runs` reconciliation after deployment.
- Live FiveDollar/API-Football plan headers, real 429 behavior and provider latency.
- Live Web Push outbox delivery on real browser subscriptions.
- Full browser E2E against the published Lovable URL.
- A durable “zero qualified queue already evaluated” marker after a full reload; this is the remaining FE-06/Improvement 2 edge case.

These production checks are required before calling the deployed runtime fully closed; repository-level synchronization can be closed once the final PR CI is green.
