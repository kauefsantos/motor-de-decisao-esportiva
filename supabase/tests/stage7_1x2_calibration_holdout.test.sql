begin;
select plan(14);

select has_table('private','model_calibration_artifacts','Stage 7 calibration artifacts are persisted outside the public API surface');

select ok(
  exists(
    select 1 from public.model_versions
    where market_family='1X2'
      and model_version='goals-baseline-v2-recency+elo-v1-w020'
      and calibration_version='temperature-v1-fit-through-2026-05-31'
      and validation_status='NOT_PRODUCTION_VALIDATED'
  ),
  'the exact calibrated artifact is registered but not production validated'
);

select ok(
  not exists(
    select 1 from public.model_versions
    where market_family='1X2'
      and model_version='goals-baseline-v2-recency+elo-v1-w020'
      and calibration_version='temperature-v1-fit-through-2026-05-31'
      and validation_status='PRODUCTION_VALIDATED'
  ),
  'Stage 7 migration never promotes the candidate'
);

select ok(
  has_function_privilege('service_role','public.store_stage7_calibration_artifact(text,text,text,text,jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.store_stage7_calibration_artifact(text,text,text,text,jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.store_stage7_calibration_artifact(text,text,text,text,jsonb,jsonb)','EXECUTE'),
  'calibration persistence is server-only'
);

select ok(
  has_function_privilege('service_role','public.get_stage7_active_calibration(text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_stage7_active_calibration(text,text)','EXECUTE'),
  'active shadow calibration lookup is server-only'
);

select ok(
  has_function_privilege('service_role','public.get_stage7_1x2_holdout_rows_page(text,timestamptz,text,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_stage7_1x2_holdout_rows_page(text,timestamptz,text,integer)','EXECUTE'),
  'prospective holdout dataset is server-only'
);

select ok(
  position('2026-09-14' in pg_get_functiondef('public.get_stage7_1x2_holdout_rows_page(text,timestamptz,text,integer)'::regprocedure))>0,
  'prospective holdout is hard-bound to the calibrator freeze date'
);

select ok(
  position('mp.prediction_at::date<fm.fixture_date' in regexp_replace(lower(pg_get_functiondef('public.get_stage7_1x2_holdout_rows_page(text,timestamptz,text,integer)'::regprocedure)), '\s+', '', 'g'))>0,
  'holdout only accepts predictions made before the fixture result date'
);

select ok(
  position('fm.has_conflict=false' in regexp_replace(lower(pg_get_functiondef('public.get_stage7_1x2_holdout_rows_page(text,timestamptz,text,integer)'::regprocedure)), '\s+', '', 'g'))>0,
  'holdout fails closed on canonical fixture conflicts'
);

select ok(
  position('holdout_passed' in lower(pg_get_functiondef('public.update_stage7_holdout_artifact(text,text,text,text,jsonb)'::regprocedure)))>0
  and position('production_validated' in lower(pg_get_functiondef('public.update_stage7_holdout_artifact(text,text,text,text,jsonb)'::regprocedure)))=0,
  'a passed holdout remains distinct from PRODUCTION_VALIDATED'
);

select ok(
  has_function_privilege('service_role','public.kick_stage7_1x2_calibration()','EXECUTE')
  and not has_function_privilege('authenticated','public.kick_stage7_1x2_calibration()','EXECUTE'),
  'Stage 7 calibration dispatcher is server-only'
);

select ok(
  has_function_privilege('service_role','public.kick_stage7_1x2_holdout()','EXECUTE')
  and not has_function_privilege('authenticated','public.kick_stage7_1x2_holdout()','EXECUTE'),
  'Stage 7 holdout dispatcher is server-only'
);

select ok(
  position('production_validated' in lower(pg_get_functiondef('public.store_stage7_calibration_artifact(text,text,text,text,jsonb,jsonb)'::regprocedure)))=0
  and position('production_validated' in lower(pg_get_functiondef('public.update_stage7_holdout_artifact(text,text,text,text,jsonb)'::regprocedure)))=0,
  'Stage 7 persistence RPCs contain no automatic production promotion path'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260914-stage7-1x2-calibration-holdout'),
  'Stage 7 release marker is registered'
);

select * from finish();
rollback;
