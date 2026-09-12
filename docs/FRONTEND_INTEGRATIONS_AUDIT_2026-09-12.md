# Frontend integrations & backend-flow audit — 2026-09-12

## Scope

Audit of frontend behavior related to external services, background/scheduled work, time zones, provider usage limits, retries, duplicate-processing prevention, persistence and synchronization with the current backend decision funnel.

Runtime note: GitHub is the versioned-code source of truth; Lovable Cloud is the runtime/database source of truth.

## Executive conclusion

The frontend previously deployed in Lovable was not synchronized with the backend flow integrated on 2026-09-12. It created/enqueued runs directly and still exposed parts of the legacy odds/result flow.

PR #82 aligns the active journey with the backend invariants:

`CSV -> idempotent draft -> provider validation -> controlled correction -> atomic finalize/enqueue -> background processing -> real odds -> persistent decision queue -> accept/decline up to 3 per target date -> finalize -> stake`

The blocking frontend findings identified by this audit are corrected in this branch. The remaining requirement before calling the production frontend fully closed is publishing this branch/main revision to Lovable and running the final browser smoke/E2E against the published URL.

## Findings and corrections

| ID | Finding | Severity / priority | Correction implemented | Post-fix behavior |
| --- | --- | --- | --- | --- |
| FE-01 | Upload bypassed the staged backend contract and created/enqueued a run directly. | High / P0 | Upload now calls `createAnalysisDraft` with a stable `clientRequestId` and routes to `/draft/$draftId/validacao`. | No analysis run is created before server-side fixture validation. Repeated submission converges on the idempotent draft. |
| FE-02 | Backend-controlled `editable_fields` were not represented in the UI. | High / P0 | Validation route uses `validateAnalysisDraft`/`correctAnalysisDraft` and renders only fields authorized by the backend. | User cannot change unrelated fields; finalization remains blocked until backend status is `READY`. |
| FE-03 | UI used the obsolete 2-weekday/3-weekend rule. | High / P0 | Active flow consumes the server daily limit and uses canonical fallback `3`. | Up to 3 selections per target date on every day of the week. |
| FE-04 | Active decision state depended partly on browser/local state. | High / P0 | Opportunities use server-backed decision queue/history plus atomic accept/decline/finalize RPCs. | Queue order, choices and finalization are server-authoritative. |
| FE-05 | Reopening opportunities could re-run preparation and external price collection. | High / P0 | `DecisionQueueGate` loads history before mounting the fresh preparation flow. | Existing/finalized decision state resumes without recalculating models or repeating external prices. |
| FE-06 | Zero-qualified result had no durable state after a full reload. | Medium / P1 | Queue build now writes a durable `DECISION_QUEUE_EVALUATED` marker to server-side `pipeline_logs`; history exposes `decisionQueueEvaluated`; the gate treats it as persisted state. | A zero-result evaluation remains terminal after refresh/reopen and does not repeat model preparation or external price collection. |
| FE-07 | Time-zone behavior still contained fixed-offset assumptions. | Medium / P1 | Draft kickoff uses `saoPauloLocalDateTimeToIso`; Bet365 day lookup now uses `saoPauloLocalDayUnixWindow`. | Current dates and historical Brazilian DST resolve according to IANA `America/Sao_Paulo`; no fixed `03:00Z` day window remains. |
| FE-08 | Client-side retry behavior could amplify provider requests. | Medium / P1 | Browser performs bounded orchestration only; provider retries/cache/shared limits/`Retry-After` remain server-side. | 429/upstream failure policy is centralized and the browser does not busy-retry provider calls. |
| FE-09 | Processing page can call enqueue again on reload. | Low / P2 | Retained intentionally because server enqueue is atomic/idempotent; retry is server-state controlled. | Reload does not create a second analysis job. |
| FE-10 | Active route could regress back to the legacy experimental pilot/rule. | Low / P2 | Active opportunities route uses `DecisionQueueGate`; regression tests assert no legacy pilot, no active `selectionLimitForDate` dependency and no active `localStorage` decision state. | Canonical server-backed flow remains the only active user journey. Detached compatibility code can be removed later as cleanup without changing current behavior. |

## External services, automation and business-rule checks

Validated in code/CI:

- automatic price lookup runs only for a fresh decision state;
- persisted or zero-result decision evaluations are recovered before external calls;
- batches expose at most 10 qualified options;
- no artificial recommendation is created to fill a batch;
- selection ceiling is 3 per target date;
- acceptance/finalization is server-authoritative;
- backend protects same-match correlation and duplicate processing;
- retries/rate limits/cache are not independently reimplemented in the browser;
- `America/Sao_Paulo` is used for kickoff conversion and daily Bet365 query windows;
- processing reload is compatible with idempotent enqueue semantics.

## Lovable Cloud checks performed during the audit

Read-only runtime inspection confirmed that the Lovable Cloud database currently has:

- the backend funnel, business-rules and automation-resilience releases applied;
- active automation reconciliation, FiveDollar maintenance and push-dispatch schedules;
- atomic analysis/decision RPCs present;
- successful maintenance/push automation executions recorded;
- no duplicate analysis job by `run_id` in the sampled runtime state;
- no stale running lease in the sampled runtime state;
- no accepted daily selection count above 3;
- no duplicate accepted selection from the same match;
- FiveDollar rate-limit state/status being persisted, including prior `RATE_LIMITED` events.

The currently published Lovable frontend was also inspected and still contained the pre-PR direct `createRun` + `enqueueAnalysis` upload flow. Therefore a new Lovable publication is required after PR #82 is merged/synchronized.

## Regression coverage

- `src/frontend-backend-flow-sync.test.ts`
  - draft-first upload contract;
  - backend-controlled validation/correction/finalization;
  - server-backed decision queue instead of legacy pilot;
  - persisted queue checked before fresh preparation;
  - durable zero-result marker is consumed by the frontend gate;
  - active flow has no decision `localStorage` dependency;
  - staged validation and Bet365 day lookup have no fixed UTC-3/`03:00Z` assumption.
- `src/frontend-ux-contract.test.ts`
  - server-backed queue UX;
  - persisted-state recovery;
  - error and zero-qualified states remain distinct;
  - mobile odds entry contract.
- `src/functional-decision-flow.e2e.test.ts`
  - canonical 3-choice portfolio and one selected market per match.
- `src/lib/sao-paulo-time.test.ts`
  - current UTC-3 behavior without hard-coding;
  - historical UTC-2 Brazilian DST;
  - local-day Unix window.
- CI also runs database regression tests, experimental-engine E2E, complete unit suite, dependency/secret gates and production build.

## Optional improvements after audit closure

These are enhancements, not unresolved blocking findings:

1. Delete detached legacy `ExperimentalMarketsPilot`/legacy odds analyzer after confirming no compatibility caller still needs it, reducing maintenance surface.
2. Remove any remaining browser-result/local-storage compatibility code once historical result migration is no longer needed.
3. Surface stable backend error codes/request IDs in collapsible diagnostics so support can distinguish rate limit, upstream outage, conflict and generic failure.
4. Add an authorized operational-status card showing worker/maintenance/push reconciliation age, provider status and cache usage.
5. Add full browser automation for double-click finalization, reload during processing, reload after zero results, 429 messaging, fourth-choice rejection and final stake handoff.

## Validation boundary

### Closed at repository/contract level

- frontend-to-backend route/function synchronization;
- draft validation/correction/finalization;
- decision queue/history/accept/decline/finalize;
- daily limit synchronization;
- existing-queue and zero-result recovery;
- duplicate-processing protections represented correctly in the frontend flow;
- frontend retry/rate-limit responsibilities;
- IANA São Paulo time semantics, including daily odds window;
- production build and automated regression gates once final CI is green.

### Still requires the new Lovable publication

- browser E2E against the newly published frontend;
- visual/interaction confirmation of draft validation in production;
- refresh/double-click behavior through the actual browser/runtime boundary;
- live user-facing handling of provider 429/5xx;
- final confirmation that Lovable is serving the PR #82/main revision rather than the previous frontend.

Once the final CI is green and the new revision is published in Lovable, the audit can be closed with a final production smoke test rather than further code corrections.
