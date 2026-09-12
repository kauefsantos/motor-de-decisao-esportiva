-- Make elo_finalize_daily() the single orchestration point for league rebuild + audit.
-- The legacy AFTER UPDATE trigger on elo_sync_state repeated both operations after
-- elo_finalize_daily() had already executed them, producing duplicate audit rows.

drop trigger if exists trg_elo_after_sync_rebuild
  on public.elo_sync_state;

drop function if exists public.elo_after_sync_rebuild();

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260912-elo-single-finalize-audit',
  'elo_single_finalize_audit',
  'Remove redundant elo_sync_state post-update trigger so elo_finalize_daily performs exactly one league rebuild and one audit per daily finalize.'
)
on conflict (version) do update
set migration_name=excluded.migration_name,
    notes=excluded.notes,
    applied_at=pg_catalog.now();
