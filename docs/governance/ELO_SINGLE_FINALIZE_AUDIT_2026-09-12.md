# Elo — single daily finalize audit

Date: 2026-09-12

## Evidence

The production Lovable Cloud state had both `public.elo_finalize_daily()` and the `trg_elo_after_sync_rebuild` trigger executing `elo_rebuild_league_ratings()` and `elo_run_audit()`. Because `elo_finalize_daily()` updates `public.elo_sync_state`, the trigger fired immediately after the explicit finalize work and repeated both operations. `elo_audit_runs` therefore contained two audit rows with the same generation timestamp on consecutive daily closes.

A read-only inspection of current functions confirmed that `public.elo_finalize_daily()` is the only current function that updates `public.elo_sync_state`, so the post-update trigger no longer has an independent orchestration responsibility.

## Correction

Migration `20260912212500_elo_single_finalize_audit.sql` removes only:

- `trg_elo_after_sync_rebuild` on `public.elo_sync_state`;
- `public.elo_after_sync_rebuild()`.

`public.elo_finalize_daily()` remains unchanged and is the single orchestration point for:

1. rebuilding league ratings once;
2. running the Elo audit once;
3. persisting the final daily sync state.

No team or league rating formula, seed, hierarchy rule, fixture history, schedule, or target competition is changed.

## Regression

`supabase/tests/elo_single_finalize_audit.test.sql` verifies that:

- the redundant trigger is absent;
- the redundant trigger function is absent;
- `elo_finalize_daily()` contains exactly one call to `elo_rebuild_league_ratings()`;
- `elo_finalize_daily()` contains exactly one call to `elo_run_audit()`.

The migration must not be merged unless all mandatory CI gates are green.
