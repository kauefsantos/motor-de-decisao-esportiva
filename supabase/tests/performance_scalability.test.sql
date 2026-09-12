begin;
select plan(17);

select ok(to_regclass('public.idx_model_predictions_run_id') is not null,'model predictions run index exists');
select ok(to_regclass('public.idx_normalized_match_stats_run_id') is not null,'normalized stats run index exists');
select ok(to_regclass('public.idx_source_fetches_run_fetched_at') is not null,'source fetch run/date index exists');
select ok(to_regclass('public.idx_raw_observations_run_observed_at') is not null,'raw observations run/date index exists');
select ok(to_regclass('public.idx_raw_observations_cache_key') is not null,'raw cache key expression index exists');
select ok(to_regclass('public.idx_analysis_runs_owner_status_created') is not null,'analysis owner/status index exists');
select ok(to_regclass('public.idx_tracking_run_status_result') is not null,'tracking run/status index exists');

select ok(has_function_privilege('service_role','public.get_owner_home_metrics(uuid)','EXECUTE') and not has_function_privilege('authenticated','public.get_owner_home_metrics(uuid)','EXECUTE'),'home aggregate is server-only');
select ok(has_function_privilege('service_role','public.get_owner_bankroll_metrics(uuid)','EXECUTE') and not has_function_privilege('authenticated','public.get_owner_bankroll_metrics(uuid)','EXECUTE'),'bankroll aggregate is server-only');
select ok(has_function_privilege('service_role','public.run_performance_retention_cleanup()','EXECUTE') and not has_function_privilege('authenticated','public.run_performance_retention_cleanup()','EXECUTE'),'performance retention is server-only');

select ok(to_regclass('public.performance_vitals') is not null,'performance vitals table exists');
select ok(not has_table_privilege('authenticated','public.performance_vitals','SELECT'),'performance vitals are not browser-readable');
select ok(exists(select 1 from cron.job where jobname='performance-retention-daily' and active),'performance retention cron is active');
select ok(exists(select 1 from cron.job where jobname='elo-daily-incremental' and command like '%elo_sync_next_target_when_idle%'),'Elo cron yields to user analysis');
select ok(exists(select 1 from cron.job where jobname='five-dollar-maintenance-daily' and command like '%maintenance_when_idle%'),'provider maintenance yields to user analysis');
select ok(position('analysis_jobs' in pg_get_functiondef('public.elo_sync_next_target_when_idle()'::regprocedure))>0,'Elo guard checks analysis workload');
select ok(exists(select 1 from public.app_schema_releases where version='20260912-performance-scalability-hardening'),'performance release is registered');

select * from finish();
rollback;