begin;
select plan(4);

select ok(
  position('pg_catalog.coalesce' in lower(pg_get_functiondef('public.create_scheduled_analysis_run_atomic(uuid,date,jsonb)'::regprocedure)))=0,
  'scheduled D+2 run creator does not call nonexistent pg_catalog.coalesce'
);

select ok(
  position('coalesce(' in lower(pg_get_functiondef('public.create_scheduled_analysis_run_atomic(uuid,date,jsonb)'::regprocedure)))>0,
  'scheduled D+2 run creator keeps null-safe fixture normalization with SQL COALESCE'
);

select ok(
  has_function_privilege('service_role','public.create_scheduled_analysis_run_atomic(uuid,date,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.create_scheduled_analysis_run_atomic(uuid,date,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.create_scheduled_analysis_run_atomic(uuid,date,jsonb)','EXECUTE'),
  'scheduled D+2 run creation remains server-only'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260913-stage3-d2-create-run-coalesce-fix'),
  'real D+2 replay fix is registered in the operational release ledger'
);

select * from finish();
rollback;
