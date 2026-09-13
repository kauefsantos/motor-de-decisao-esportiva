begin;
select plan(8);

select lives_ok(
  $$select public.kick_external_api_maintenance()$$,
  'maintenance dispatcher can enqueue pg_net and write automation ledger at runtime'
);

select ok(
  exists(select 1 from public.automation_runs where job_name='five-dollar-maintenance-daily' and request_id is not null),
  'maintenance dispatch writes a request id to automation_runs'
);

select ok(
  position('on conflict (request_id)' in lower(pg_get_functiondef('public.kick_analysis_worker()'::regprocedure)))=0,
  'analysis worker dispatcher does not target the partial request_id index explicitly'
);

select ok(
  position('on conflict (request_id)' in lower(pg_get_functiondef('public.kick_external_api_maintenance()'::regprocedure)))=0,
  'maintenance dispatcher does not target the partial request_id index explicitly'
);

select ok(
  position('on conflict (request_id)' in lower(pg_get_functiondef('public.kick_push_delivery_dispatcher()'::regprocedure)))=0,
  'push dispatcher does not target the partial request_id index explicitly'
);

select ok(
  position('on conflict (request_id)' in lower(pg_get_functiondef('public.kick_scheduled_daily_analysis()'::regprocedure)))=0,
  'scheduled D+2 dispatcher does not target the partial request_id index explicitly'
);

select ok(
  position('on conflict do nothing' in lower(pg_get_functiondef('public.kick_scheduled_daily_analysis()'::regprocedure)))>0,
  'scheduled D+2 dispatcher keeps automation ledger writes idempotent with bare ON CONFLICT'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260912-automation-dispatch-conflict-fix'),
  'production smoke conflict fix is registered'
);

select * from finish();
rollback;