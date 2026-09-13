begin;
select plan(6);

select ok(
  to_regprocedure('public.get_five_dollar_model_history_rows(timestamptz,integer)') is not null,
  'model-history helper remains available after materialization'
);

select ok(
  position('private.five_dollar_model_matches' in pg_get_functiondef('public.get_five_dollar_model_history_rows(timestamptz,integer)'::regprocedure))>0
  and position('public.raw_observations' in pg_get_functiondef('public.get_five_dollar_model_history_rows(timestamptz,integer)'::regprocedure))=0,
  'model-history helper now reads the compact canonical layer instead of raw observations'
);

select ok(
  position('first_observed_at' in lower(pg_get_functiondef('public.get_five_dollar_model_history_rows(timestamptz,integer)'::regprocedure)))>0
  and position('p_prediction_at' in lower(pg_get_functiondef('public.get_five_dollar_model_history_rows(timestamptz,integer)'::regprocedure)))>0,
  'model history remains point-in-time bounded before prediction_at'
);

select ok(
  position('research_' in lower(pg_get_functiondef('public.get_five_dollar_model_history_rows(timestamptz,integer)'::regprocedure)))=0,
  'research-only metrics are not transferred into the current inference dataset'
);

select ok(
  has_function_privilege('service_role','public.get_five_dollar_model_history_rows(timestamptz,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_five_dollar_model_history_rows(timestamptz,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_five_dollar_model_history_rows(timestamptz,integer)','EXECUTE'),
  'model-history helper remains server-only'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260913-stage3-model-history-query')
  and exists(select 1 from public.app_schema_releases where version='20260913-stage3-model-history-materialized'),
  'original reconciliation and materialized replacement are both registered in the operational ledger'
);

select * from finish();
rollback;
