begin;
select plan(2);
select ok(to_regclass('public.idx_raw_observations_source_observed_at') is not null,'raw source/time window index exists');
select ok(exists(select 1 from public.app_schema_releases where version='20260912-raw-history-window-index'),'raw history window index release is registered');
select * from finish();
rollback;