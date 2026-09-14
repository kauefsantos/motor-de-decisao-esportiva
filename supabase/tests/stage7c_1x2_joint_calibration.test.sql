begin;
select plan(8);

select ok(
  exists(
    select 1 from public.model_versions
    where market_family='1X2'
      and model_version='goals-baseline-v2-recency+elo-v1-w020'
      and calibration_version='joint-logit-v1-fit-through-2026-05-31'
      and validation_status='NOT_PRODUCTION_VALIDATED'
  ),
  'Stage 7C joint artifact is registered without production validation'
);

select ok(
  not exists(
    select 1 from public.model_versions
    where market_family='1X2'
      and model_version='goals-baseline-v2-recency+elo-v1-w020'
      and calibration_version='joint-logit-v1-fit-through-2026-05-31'
      and validation_status='PRODUCTION_VALIDATED'
  ),
  'Stage 7C migration never promotes the candidate'
);

select ok(
  has_function_privilege('service_role','public.store_stage7c_calibration_artifact(text,text,text,text,jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.store_stage7c_calibration_artifact(text,text,text,text,jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.store_stage7c_calibration_artifact(text,text,text,text,jsonb,jsonb)','EXECUTE'),
  'Stage 7C calibration persistence is server-only'
);

select ok(
  has_function_privilege('service_role','public.kick_stage7c_1x2_calibration()','EXECUTE')
  and not has_function_privilege('authenticated','public.kick_stage7c_1x2_calibration()','EXECUTE'),
  'Stage 7C calibration dispatcher is server-only'
);

select ok(
  has_function_privilege('service_role','public.kick_stage7c_1x2_holdout()','EXECUTE')
  and not has_function_privilege('authenticated','public.kick_stage7c_1x2_holdout()','EXECUTE'),
  'Stage 7C holdout dispatcher is server-only'
);

select ok(
  position('validation_status=''production_validated''' in regexp_replace(lower(pg_get_functiondef('public.store_stage7c_calibration_artifact(text,text,text,text,jsonb,jsonb)'::regprocedure)), '\s+', '', 'g'))=0,
  'Stage 7C persistence contains no automatic production promotion path'
);

select ok(
  position('shadow_ready' in lower(pg_get_functiondef('public.kick_stage7c_1x2_holdout()'::regprocedure)))>0,
  'Stage 7C holdout requires a frozen SHADOW_READY artifact'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260914-stage7c-1x2-joint-calibration'),
  'Stage 7C release marker is registered'
);

select * from finish();
rollback;
