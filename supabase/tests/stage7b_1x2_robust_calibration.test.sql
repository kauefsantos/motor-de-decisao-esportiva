begin;
select plan(9);

select ok(
  exists(
    select 1 from public.model_versions
    where market_family='1X2'
      and model_version='goals-baseline-v2-recency+elo-v1-w020'
      and calibration_version='isotonic-classwise-v1-fit-through-2026-05-31'
      and validation_status='NOT_PRODUCTION_VALIDATED'
  ),
  'Stage 7B candidate is registered but never production validated by migration'
);

select ok(
  not exists(
    select 1 from public.model_versions
    where market_family='1X2'
      and model_version='goals-baseline-v2-recency+elo-v1-w020'
      and calibration_version='isotonic-classwise-v1-fit-through-2026-05-31'
      and validation_status='PRODUCTION_VALIDATED'
  ),
  'Stage 7B migration contains no automatic promotion'
);

select ok(
  has_function_privilege('service_role','public.store_stage7b_calibration_artifact(text,text,text,text,jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.store_stage7b_calibration_artifact(text,text,text,text,jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.store_stage7b_calibration_artifact(text,text,text,text,jsonb,jsonb)','EXECUTE'),
  'Stage 7B calibration persistence is server-only'
);

select ok(
  position('classwise_isotonic_blend' in lower(pg_get_functiondef('public.store_stage7b_calibration_artifact(text,text,text,text,jsonb,jsonb)'::regprocedure)))>0,
  'Stage 7B persistence binds the artifact to the intended calibration method'
);

select ok(
  position('validation_status=''production_validated''' in regexp_replace(lower(pg_get_functiondef('public.store_stage7b_calibration_artifact(text,text,text,text,jsonb,jsonb)'::regprocedure)), '\s+', '', 'g'))=0,
  'Stage 7B persistence cannot promote directly to production'
);

select ok(
  has_function_privilege('service_role','public.kick_stage7b_1x2_calibration()','EXECUTE')
  and not has_function_privilege('authenticated','public.kick_stage7b_1x2_calibration()','EXECUTE'),
  'Stage 7B calibration dispatcher is server-only'
);

select ok(
  has_function_privilege('service_role','public.kick_stage7b_1x2_holdout()','EXECUTE')
  and not has_function_privilege('authenticated','public.kick_stage7b_1x2_holdout()','EXECUTE'),
  'Stage 7B holdout dispatcher is server-only'
);

select ok(
  position('shadow_ready' in lower(pg_get_functiondef('public.kick_stage7b_1x2_holdout()'::regprocedure)))>0,
  'Stage 7B holdout cannot start before a frozen shadow-ready artifact exists'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260914-stage7b-1x2-robust-calibration'),
  'Stage 7B release marker is registered'
);

select * from finish();
rollback;
