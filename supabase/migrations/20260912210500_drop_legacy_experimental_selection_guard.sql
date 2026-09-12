-- Remove the obsolete weekday/weekend experimental selection limit.
-- The canonical policy is fixed at zero to three final selections per day/run
-- and is enforced by public.enforce_experimental_selection_limit().

drop trigger if exists experimental_selection_limit_guard
  on public.experimental_bet_tracking;

drop function if exists private.experimental_selection_limit_guard();

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260912-e2e-drop-legacy-selection-guard',
  'drop_legacy_experimental_selection_guard',
  'Remove obsolete 2-on-weekdays/3-on-weekends trigger so Lovable Cloud uses only the fixed max-3 selection policy.'
)
on conflict (version) do update
set migration_name=excluded.migration_name,
    notes=excluded.notes,
    applied_at=pg_catalog.now();
