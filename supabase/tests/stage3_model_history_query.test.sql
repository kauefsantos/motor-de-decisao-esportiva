begin;
select plan(6);

select ok(
  exists(
    select 1 from pg_indexes
    where schemaname='public'
      and tablename='raw_observations'
      and indexname='idx_raw_observations_model_history_latest'
  ),
  'model history has a targeted latest-observation index'
);

select ok(
  position('r.observed_at < p_prediction_at' in pg_get_functiondef('public.get_five_dollar_model_history_rows(timestamptz,integer)'::regprocedure))>0,
  'model history remains strictly point-in-time before prediction_at'
);

select ok(
  position('distinct on' in lower(pg_get_functiondef('public.get_five_dollar_model_history_rows(timestamptz,integer)'::regprocedure)))>0,
  'model history is deduplicated in Lovable Cloud before transfer'
);

select ok(
  position('research_' in lower(pg_get_functiondef('public.get_five_dollar_model_history_rows(timestamptz,integer)'::regprocedure)))=0,
  'research-only metrics are not transferred into the current inference dataset'
);

select ok(
  has_function_privilege('service_role','public.get_five_dollar_model_history_rows(timestamptz,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_five_dollar_model_history_rows(timestamptz,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_five_dollar_model_history_rows(timestamptz,integer)','EXECUTE'),
  'deduplicated model history helper remains server-only'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260913-stage3-model-history-query'),
  'Stage 3 model-history performance reconciliation is registered'
);

select * from finish();
rollback;
