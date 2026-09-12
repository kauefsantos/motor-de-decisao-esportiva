begin;
select plan(20);

select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='analysis_jobs' and column_name='lease_token'),'analysis job has lease token');
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='analysis_jobs' and column_name='lease_expires_at'),'analysis job has lease expiry');
select ok(has_function_privilege('service_role','public.heartbeat_analysis_job(uuid,uuid)','EXECUTE') and not has_function_privilege('authenticated','public.heartbeat_analysis_job(uuid,uuid)','EXECUTE'),'heartbeat is service-only');
select ok(has_function_privilege('service_role','public.complete_analysis_job_step_atomic(uuid,uuid,text,boolean)','EXECUTE') and not has_function_privilege('authenticated','public.complete_analysis_job_step_atomic(uuid,uuid,text,boolean)','EXECUTE'),'fenced completion is service-only');

select lives_ok($outer$
do $test$
declare
  v_user uuid:='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_run uuid:=gen_random_uuid();
  v_dispatch uuid:=gen_random_uuid();
  v_lease uuid;
  v_ok boolean;
  v_accepted boolean;
begin
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_user,'authenticated','authenticated','lease-test@example.invalid','{"provider":"google","providers":["google"]}','{}',now(),now());
  insert into public.analysis_runs(id,owner_id,status,matches_total) values(v_run,v_user,'CREATED',0);
  insert into public.analysis_jobs(run_id,user_id,dispatch_token,status) values(v_run,v_user,v_dispatch,'QUEUED');
  select lease_token into v_lease from public.claim_analysis_job(v_run,v_dispatch);
  if v_lease is null then raise exception 'lease not created'; end if;
  select public.heartbeat_analysis_job(v_run,v_lease) into v_ok;
  if not v_ok then raise exception 'valid heartbeat rejected'; end if;
  update public.analysis_jobs set lease_expires_at=now()-interval '1 second' where run_id=v_run;
  select public.heartbeat_analysis_job(v_run,v_lease) into v_ok;
  if v_ok then raise exception 'expired heartbeat accepted'; end if;
  select accepted into v_accepted from public.complete_analysis_job_step_atomic(v_run,v_lease,'RESOLVE',false);
  if v_accepted then raise exception 'stale lease completed step'; end if;
end
$test$
$outer$,'lease heartbeat works and stale worker is fenced');

select ok(to_regclass('public.push_delivery_outbox') is not null,'push outbox exists');
select ok(not has_table_privilege('authenticated','public.push_delivery_outbox','SELECT'),'push outbox is not browser-readable');
select ok(has_function_privilege('service_role','public.claim_push_delivery_batch(integer)','EXECUTE') and not has_function_privilege('authenticated','public.claim_push_delivery_batch(integer)','EXECUTE'),'push claims are service-only');

select lives_ok($outer$
do $test$
declare
  v_user uuid:='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v1 uuid; v2 uuid; v_lock uuid; v_ok boolean;
begin
  select public.enqueue_push_delivery_event('analysis-ready:test',v_user,'ANALYSIS_READY','{}') into v1;
  select public.enqueue_push_delivery_event('analysis-ready:test',v_user,'ANALYSIS_READY','{}') into v2;
  if v1 is distinct from v2 or (select count(*) from public.push_delivery_outbox where event_key='analysis-ready:test')<>1 then raise exception 'outbox idempotency failed'; end if;
  select lock_token into v_lock from public.claim_push_delivery_batch(5) where id=v1;
  if v_lock is null then raise exception 'outbox claim failed'; end if;
  select public.fail_push_delivery_event(v1,v_lock,'temporary',true,'{"resolvedSubscriptionIds":[]}') into v_ok;
  if not v_ok or not exists(select 1 from public.push_delivery_outbox where id=v1 and status='PENDING' and attempts=1 and next_attempt_at>now()) then raise exception 'retry backoff state failed'; end if;
end
$test$
$outer$,'push outbox is idempotent and retryable');

select ok(to_regclass('public.automation_runs') is not null,'automation outcome ledger exists');
select ok(not has_table_privilege('authenticated','public.automation_runs','SELECT'),'automation ledger is not browser-readable');
select ok(has_function_privilege('service_role','public.reconcile_automation_runs(integer)','EXECUTE') and not has_function_privilege('authenticated','public.reconcile_automation_runs(integer)','EXECUTE'),'automation reconciliation is service-only');
select ok(position('lease_expires_at' in pg_get_functiondef('public.kick_analysis_worker()'::regprocedure))>0,'worker recovery dispatch uses lease expiry');
select ok(position('automation_runs' in pg_get_functiondef('public.kick_analysis_worker()'::regprocedure))>0,'worker dispatch records automation request');
select ok(position('automation_runs' in pg_get_functiondef('public.kick_external_api_maintenance()'::regprocedure))>0,'maintenance dispatch records automation request');
select ok(position('automation_runs' in pg_get_functiondef('public.kick_push_delivery_dispatcher()'::regprocedure))>0,'push dispatch records automation request');
select ok(exists(select 1 from cron.job where jobname='push-delivery-dispatch' and active),'push recovery cron is active');
select ok(exists(select 1 from cron.job where jobname='automation-http-reconcile' and active),'automation response reconciliation cron is active');
select ok(exists(select 1 from public.app_schema_releases where version='20260912-integrations-automation-resilience'),'resilience release is registered');
select ok(has_function_privilege('service_role','public.acquire_external_api_slot(text,integer,integer)','EXECUTE'),'shared API rate primitive remains available to adapters');

select * from finish();
rollback;
