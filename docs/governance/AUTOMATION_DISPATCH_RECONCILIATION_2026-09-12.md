# Automation dispatch runtime reconciliation — 2026-09-12

## Evidence

A production smoke identified a PostgreSQL runtime error in the automation ledger path: `automation_runs.request_id` is protected by a partial unique index, while the original dispatcher functions used `ON CONFLICT(request_id) DO NOTHING`. PostgreSQL cannot infer that partial index from the explicit conflict target.

The Lovable Cloud runtime was hotfixed to use bare `ON CONFLICT DO NOTHING`, and a later audit confirmed all three dispatcher functions currently contain the corrected behavior. However, the versioned migration and regression remained only in the historical PR #81 and were absent from `main`, leaving GitHub and Lovable Cloud divergent.

## Reconciliation

This change restores the production hotfix to the versioned source of truth by adding:

- `20260912071000_automation_dispatch_conflict_fix.sql`;
- a runtime pgTAP regression that executes the maintenance dispatcher inside a rollback transaction;
- assertions that none of the three dispatcher functions targets the partial `request_id` index explicitly;
- release metadata `20260912-automation-dispatch-conflict-fix`.

No new production behavior is introduced. The migration represents behavior that is already present in Lovable Cloud and makes fresh environments reproducible from GitHub.

## Validation rule

The reconciliation must not be merged unless mandatory CI, database regression and security gates are green. After merge, the release marker should be reconciled in Lovable Cloud and the historical PR #81 can be closed as superseded.