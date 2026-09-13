begin;
select plan(12);

select ok(
  to_regclass('public.idx_raw_observations_source_observed_at') is not null,
  'raw source/time history index exists'
);
select ok(
  to_regclass('public.idx_raw_observations_run_observed_at') is not null,
  'raw run/time index exists'
);
select ok(
  to_regclass('public.idx_model_predictions_run_id') is not null,
  'model predictions run index exists'
);
select ok(
  to_regclass('public.idx_normalized_match_stats_run_id') is not null,
  'normalized stats run index exists'
);
select ok(
  to_regclass('public.idx_source_fetches_run_id') is not null,
  'source fetches run index exists'
);
select ok(
  to_regclass('public.performance_vitals') is not null,
  'performance vitals storage exists'
);
select ok(
  coalesce((select relrowsecurity from pg_class where oid='public.performance_vitals'::regclass), false),
  'performance vitals has RLS enabled'
);
select ok(
  to_regprocedure('public.get_raw_observation_cache_rows(text,text,text[])') is not null,
  'targeted raw cache RPC exists'
);
select ok(
  to_regprocedure('public.run_performance_retention_cleanup()') is not null,
  'performance retention function exists'
);
select ok(
  exists(
    select 1 from cron.job
    where jobname='elo-daily-incremental'
      and active
      and command like '%elo_sync_next_target_when_idle%'
  ),
  'Elo maintenance yields to analysis work'
);
select ok(
  exists(
    select 1 from cron.job
    where jobname='five-dollar-maintenance-daily'
      and active
      and command like '%kick_external_api_maintenance_when_idle%'
  ),
  'provider maintenance yields to analysis work'
);
select ok(
  exists(
    select 1 from cron.job
    where jobname='performance-retention-daily'
      and active
      and command like '%run_performance_retention_cleanup%'
  )
  and exists(
    select 1 from public.app_schema_releases
    where version='20260913-performance-runtime-reconciliation'
  ),
  'retention schedule and reconciliation release are registered'
);

select * from finish();
rollback;