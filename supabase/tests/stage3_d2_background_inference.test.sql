begin;
select plan(4);

select ok(
  position('on conflict (request_id)' in lower(pg_get_functiondef('public.kick_scheduled_daily_analysis()'::regprocedure)))=0,
  'scheduled D+2 dispatcher does not target the partial request_id index explicitly'
);

select ok(
  position('on conflict do nothing' in lower(pg_get_functiondef('public.kick_scheduled_daily_analysis()'::regprocedure)))>0,
  'scheduled D+2 dispatcher keeps idempotent conflict handling'
);

select ok(
  has_function_privilege('service_role','public.kick_scheduled_daily_analysis()','EXECUTE')
  and not has_function_privilege('authenticated','public.kick_scheduled_daily_analysis()','EXECUTE')
  and not has_function_privilege('anon','public.kick_scheduled_daily_analysis()','EXECUTE'),
  'scheduled D+2 dispatcher remains server-only'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260913-stage3-d2-background-inference'),
  'Stage 3 runtime reconciliation is registered'
);

select * from finish();
rollback;
