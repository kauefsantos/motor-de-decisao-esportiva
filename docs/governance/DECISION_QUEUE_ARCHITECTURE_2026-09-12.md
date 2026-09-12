# Decision queue architecture hardening — 2026-09-12

## Scope

This change aligns the TypeScript decision-queue boundary with the database enforcement already present in Lovable Cloud.

## Invariants

- Executable decision-queue candidates must use `PRODUCTION_VALIDATED` predictions only.
- The executable probability is `conservative_probability` when present, otherwise `p_cal`; raw experimental probability is not an executable fallback.
- A calibration version is mandatory before a candidate can enter the application-level evaluation path.
- Lovable Cloud remains the final defense-in-depth authority through `replace_decision_queue_atomic`.
- The response reports the persisted queue count returned by Lovable Cloud, not the number of pre-persistence candidates.
- Zero qualified opportunities is a valid outcome.
- Portfolio thresholds and concentration rules are unchanged.

## Architecture

`src/lib/decision-queue.functions.ts` now uses the typed `AdminDb` boundary and is included in the explicit-`any` architecture gate. This prevents future regressions back to an untyped privileged database client.

The obsolete caller-controlled portfolio limit was removed from the operational decision queue. The portfolio policy remains owned by the engine constants (`MAX_SELECTIONS`, one selection per match and at most two per market family).

## Validation

Mandatory CI must pass static architecture/type checks, database regressions, functional/experimental E2E, unit tests, build, bundle/load checks and browser/accessibility checks before merge.
