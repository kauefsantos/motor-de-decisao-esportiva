begin;
select plan(13);

select ok(
  exists(
    select 1 from public.model_versions
    where market_family='1X2'
      and model_version='goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040'
      and calibration_version='stage9-ensemble-calibration-v1-fit-through-2026-05-31'
      and validation_status='NOT_PRODUCTION_VALIDATED'
  ),
  'Stage 9 exact ensemble artifact starts not production validated'
);

select ok(
  has_function_privilege('service_role','public.store_stage9_calibration_artifact(text,text,text,text,jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.store_stage9_calibration_artifact(text,text,text,text,jsonb,jsonb)','EXECUTE'),
  'Stage 9 calibration persistence is server-only'
);

select ok(
  has_function_privilege('service_role','public.get_stage9_active_calibration(text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_stage9_active_calibration(text,text)','EXECUTE'),
  'Stage 9 active calibrator lookup is server-only'
);

select ok(
  has_function_privilege('service_role','public.get_stage9_1x2_holdout_rows_page(timestamptz,text,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_stage9_1x2_holdout_rows_page(timestamptz,text,integer)','EXECUTE'),
  'Stage 9 prospective holdout dataset is server-only'
);

select ok(
  position('2026-09-14' in pg_get_functiondef('public.get_stage9_1x2_holdout_rows_page(timestamptz,text,integer)'::regprocedure))>0,
  'Stage 9 holdout is hard-bound to the freeze date'
);

select ok(
  position('mp.prediction_at::date<fm.fixture_date' in regexp_replace(lower(pg_get_functiondef('public.get_stage9_1x2_holdout_rows_page(timestamptz,text,integer)'::regprocedure)), '\s+', '', 'g'))>0,
  'Stage 9 holdout accepts only genuinely pre-match predictions'
);

select ok(
  position('fm.has_conflict=false' in regexp_replace(lower(pg_get_functiondef('public.get_stage9_1x2_holdout_rows_page(timestamptz,text,integer)'::regprocedure)), '\s+', '', 'g'))>0,
  'Stage 9 holdout fails closed on result conflicts'
);

select ok(
  position('validation_status=''production_validated''' in regexp_replace(lower(pg_get_functiondef('public.store_stage9_calibration_artifact(text,text,text,text,jsonb,jsonb)'::regprocedure)), '\s+', '', 'g'))=0,
  'retrospective calibration cannot promote the model'
);

select ok(
  position('validation_status=''production_validated''' in regexp_replace(lower(pg_get_functiondef('public.update_stage9_holdout_artifact(text,text,text,text,jsonb)'::regprocedure)), '\s+', '', 'g'))=0,
  'holdout persistence remains distinct from governed promotion'
);

select ok(
  position('sampleSize' in pg_get_functiondef('public.promote_stage9_1x2_if_holdout_passed()'::regprocedure))>0
  and position('<200' in regexp_replace(pg_get_functiondef('public.promote_stage9_1x2_if_holdout_passed()'::regprocedure), '\s+', '', 'g'))>0
  and position('0.10' in pg_get_functiondef('public.promote_stage9_1x2_if_holdout_passed()'::regprocedure))>0,
  'promotion rechecks minimum holdout sample and calibration tolerance'
);

select ok(
  position('noLeakage' in pg_get_functiondef('public.promote_stage9_1x2_if_holdout_passed()'::regprocedure))>0
  and position('leagueStability' in pg_get_functiondef('public.promote_stage9_1x2_if_holdout_passed()'::regprocedure))>0,
  'promotion rechecks leakage and stability gates'
);

select ok(
  has_function_privilege('service_role','public.kick_stage9_1x2_calibration()','EXECUTE')
  and has_function_privilege('service_role','public.kick_stage9_1x2_holdout()','EXECUTE')
  and not has_function_privilege('authenticated','public.kick_stage9_1x2_calibration()','EXECUTE'),
  'Stage 9 dispatchers are server-only'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260914-stage9-1x2-ensemble-calibration'),
  'Stage 9 release marker is registered'
);

select * from finish();
rollback;
