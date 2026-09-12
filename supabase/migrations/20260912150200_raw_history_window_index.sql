-- Production pg_stat_statements showed the historical feature query
-- filtering raw observations by source + observed_at as the most expensive
-- recurring PostgREST read. Index the exact predicate/order shape.
create index if not exists idx_raw_observations_source_observed_at
  on public.raw_observations(source, observed_at);

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260912-raw-history-window-index',
  'raw_history_window_index',
  'Indexes source + observed_at to accelerate historical raw-observation windows used by feature/model reads.'
)
on conflict (version) do update set
  migration_name=excluded.migration_name,
  notes=excluded.notes,
  applied_at=now();