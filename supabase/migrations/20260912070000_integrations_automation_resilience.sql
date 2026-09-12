-- Close remaining Integrations & Automations audit findings.
-- Runtime truth: Lovable Cloud. Versioned truth: GitHub main.

-- ---------------------------------------------------------------------------
-- 1) Renewable analysis-job lease + fencing
-- ---------------------------------------------------------------------------
alter table public.analysis_jobs add column if not exists lease_token uuid;
alter table public.analysis_jobs add column if not exists lease_expires_at timestamptz;
create index if not exists idx_analysis_jobs_lease_expiry on public.analysis_jobs(status,lease_expires_at) where status='RUNNING';

create or replace function public.claim_analysis_job(p_run_id uuid,p_dispatch_token uuid)
returns table(run_id uuid,user_id uuid,completed_steps text[],attempts integer,lease_token uuid)
language plpgsql security definer set search_path=''
as $$
declare v_lease uuid:=gen_random_uuid();
begin
  return query
  update public.analysis_jobs j
     set status='RUNNING',attempts=j.attempts+1,locked_at=pg_catalog.now(),
         lease_token=v_lease,lease_expires_at=pg_catalog.now()+interval '90 seconds',
         dispatch_token=gen_random_uuid(),last_error=null,updated_at=pg_catalog.now()
   where j.run_id=p_run_id and j.dispatch_token=p_dispatch_token
     and (j.status='QUEUED' or (j.status='RUNNING' and (j.lease_expires_at is null or j.lease_expires_at<pg_catalog.now())))
  returning j.run_id,j.user_id,j.completed_steps,j.attempts,j.lease_token;
end;$$;
revoke all on function public.claim_analysis_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_analysis_job(uuid,uuid) to service_role;

create or replace function public.heartbeat_analysis_job(p_run_id uuid,p_lease_token uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_changed integer;
begin
  update public.analysis_jobs set locked_at=pg_catalog.now(),lease_expires_at=pg_catalog.now()+interval '90 seconds',updated_at=pg_catalog.now()
   where run_id=p_run_id and status='RUNNING' and lease_token=p_lease_token and lease_expires_at>pg_catalog.now();
  get diagnostics v_changed=row_count; return v_changed=1;
end;$$;
revoke all on function public.heartbeat_analysis_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.heartbeat_analysis_job(uuid,uuid) to service_role;

create or replace function public.start_analysis_job_step_atomic(p_run_id uuid,p_lease_token uuid,p_step text)
returns table(accepted boolean)
language plpgsql security definer set search_path=''
as $$
declare v_changed integer;
begin
  update public.analysis_jobs set current_step=p_step,locked_at=pg_catalog.now(),updated_at=pg_catalog.now()
   where run_id=p_run_id and status='RUNNING' and lease_token=p_lease_token and lease_expires_at>pg_catalog.now();
  get diagnostics v_changed=row_count; return query select v_changed=1;
end;$$;
revoke all on function public.start_analysis_job_step_atomic(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.start_analysis_job_step_atomic(uuid,uuid,text) to service_role;

create or replace function public.complete_analysis_job_step_atomic(p_run_id uuid,p_lease_token uuid,p_step text,p_finished boolean)
returns table(accepted boolean)
language plpgsql security definer set search_path=''
as $$
declare v_changed integer;
begin
  update public.analysis_jobs j
     set status=case when p_finished then 'DONE' else 'QUEUED' end,
         current_step=null,
         completed_steps=case when p_step is null or p_step='' or p_step=any(j.completed_steps) then j.completed_steps else pg_catalog.array_append(j.completed_steps,p_step) end,
         completed_at=case when p_finished then pg_catalog.now() else null end,
         locked_at=null,lease_token=null,lease_expires_at=null,updated_at=pg_catalog.now()
   where j.run_id=p_run_id and j.status='RUNNING' and j.lease_token=p_lease_token and j.lease_expires_at>pg_catalog.now();
  get diagnostics v_changed=row_count; return query select v_changed=1;
end;$$;
revoke all on function public.complete_analysis_job_step_atomic(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.complete_analysis_job_step_atomic(uuid,uuid,text,boolean) to service_role;

create or replace function public.fail_analysis_job_atomic(p_run_id uuid,p_lease_token uuid,p_error text)
returns table(accepted boolean)
language plpgsql security definer set search_path=''
as $$
declare v_changed integer;
begin
  update public.analysis_jobs set status='ERROR',last_error=pg_catalog.left(coalesce(p_error,'Falha desconhecida'),1000),
    locked_at=null,lease_token=null,lease_expires_at=null,updated_at=pg_catalog.now()
   where run_id=p_run_id and status='RUNNING' and lease_token=p_lease_token and lease_expires_at>pg_catalog.now();
  get diagnostics v_changed=row_count; return query select v_changed=1;
end;$$;
revoke all on function public.fail_analysis_job_atomic(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fail_analysis_job_atomic(uuid,uuid,text) to service_role;

-- Retry resets any previous lease and rotates the dispatch capability.
create or replace function public.retry_analysis_job_atomic(p_run_id uuid,p_user_id uuid)
returns table(retried boolean,status text)
language plpgsql security definer set search_path=''
as $$
declare v_changed integer:=0; v_status text;
begin
  update public.analysis_jobs j set status='QUEUED',current_step=null,last_error=null,locked_at=null,
    lease_token=null,lease_expires_at=null,completed_at=null,dispatch_token=gen_random_uuid(),updated_at=pg_catalog.now()
   where j.run_id=p_run_id and j.user_id=p_user_id and j.status='ERROR';
  get diagnostics v_changed=row_count;
  if v_changed=1 then
    update public.analysis_runs r set status='RUNNING',updated_at=pg_catalog.now() where r.id=p_run_id and r.owner_id=p_user_id;
    v_status:='QUEUED';
  else
    select j.status into v_status from public.analysis_jobs j where j.run_id=p_run_id and j.user_id=p_user_id;
  end if;
  return query select v_changed=1,v_status;
end;$$;
revoke all on function public.retry_analysis_job_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.retry_analysis_job_atomic(uuid,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2) Durable Web Push outbox
-- ---------------------------------------------------------------------------
create table if not exists public.push_delivery_outbox(
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}',
  delivery_state jsonb not null default '{"resolvedSubscriptionIds":[]}',
  status text not null default 'PENDING' check(status in ('PENDING','PROCESSING','SENT','DEAD')),
  attempts integer not null default 0 check(attempts>=0 and attempts<=20),
  next_attempt_at timestamptz not null default now(),
  lock_token uuid,
  locked_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_push_delivery_outbox_ready on public.push_delivery_outbox(status,next_attempt_at,created_at);
alter table public.push_delivery_outbox enable row level security;
revoke all on public.push_delivery_outbox from public,anon,authenticated;
grant all on public.push_delivery_outbox to service_role;

create or replace function public.enqueue_push_delivery_event(p_event_key text,p_user_id uuid,p_event_type text,p_payload jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_id uuid;
begin
  insert into public.push_delivery_outbox(event_key,user_id,event_type,payload)
  values(pg_catalog.left(p_event_key,300),p_user_id,pg_catalog.left(p_event_type,80),coalesce(p_payload,'{}'::jsonb))
  on conflict(event_key) do update set event_key=excluded.event_key
  returning id into v_id;
  return v_id;
end;$$;
revoke all on function public.enqueue_push_delivery_event(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_push_delivery_event(text,uuid,text,jsonb) to service_role;

create or replace function public.claim_push_delivery_batch(p_limit integer default 5)
returns setof public.push_delivery_outbox language plpgsql security definer set search_path=''
as $$
begin
  if p_limit<1 or p_limit>20 then raise exception 'Lote de push inválido.'; end if;
  return query
  with picked as (
    select id from public.push_delivery_outbox
     where ((status='PENDING' and next_attempt_at<=pg_catalog.now()) or (status='PROCESSING' and locked_at<pg_catalog.now()-interval '2 minutes'))
       and attempts<5
     order by next_attempt_at,created_at limit p_limit for update skip locked
  )
  update public.push_delivery_outbox o
     set status='PROCESSING',attempts=o.attempts+1,lock_token=gen_random_uuid(),locked_at=pg_catalog.now(),updated_at=pg_catalog.now()
   where o.id in (select id from picked)
  returning o.*;
end;$$;
revoke all on function public.claim_push_delivery_batch(integer) from public,anon,authenticated;
grant execute on function public.claim_push_delivery_batch(integer) to service_role;

create or replace function public.complete_push_delivery_event(p_id uuid,p_lock_token uuid,p_delivery_state jsonb)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_changed integer;
begin
  update public.push_delivery_outbox set status='SENT',delivery_state=coalesce(p_delivery_state,delivery_state),sent_at=pg_catalog.now(),
    lock_token=null,locked_at=null,last_error=null,updated_at=pg_catalog.now()
   where id=p_id and status='PROCESSING' and lock_token=p_lock_token;
  get diagnostics v_changed=row_count; return v_changed=1;
end;$$;
revoke all on function public.complete_push_delivery_event(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.complete_push_delivery_event(uuid,uuid,jsonb) to service_role;

create or replace function public.fail_push_delivery_event(p_id uuid,p_lock_token uuid,p_error text,p_retryable boolean,p_delivery_state jsonb)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_changed integer;
begin
  update public.push_delivery_outbox o set
    status=case when p_retryable and o.attempts<5 then 'PENDING' else 'DEAD' end,
    next_attempt_at=case when p_retryable and o.attempts<5 then pg_catalog.now()+pg_catalog.make_interval(secs=>least(900,30*(2^greatest(0,o.attempts-1)))::integer) else o.next_attempt_at end,
    delivery_state=coalesce(p_delivery_state,o.delivery_state),last_error=pg_catalog.left(coalesce(p_error,'Falha de push'),1000),
    lock_token=null,locked_at=null,updated_at=pg_catalog.now()
   where o.id=p_id and o.status='PROCESSING' and o.lock_token=p_lock_token;
  get diagnostics v_changed=row_count; return v_changed=1;
end;$$;
revoke all on function public.fail_push_delivery_event(uuid,uuid,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.fail_push_delivery_event(uuid,uuid,text,boolean,jsonb) to service_role;

create table if not exists private.push_dispatch_config(
  singleton boolean primary key default true check(singleton),
  dispatch_token uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);
insert into private.push_dispatch_config(singleton) values(true) on conflict(singleton) do nothing;
revoke all on private.push_dispatch_config from public,anon,authenticated;
grant select,update on private.push_dispatch_config to service_role;

create or replace function public.validate_push_dispatch_token(p_token uuid)
returns boolean language sql security definer set search_path='' stable as $$
 select exists(select 1 from private.push_dispatch_config where singleton=true and dispatch_token=p_token)
$$;
revoke all on function public.validate_push_dispatch_token(uuid) from public,anon,authenticated;
grant execute on function public.validate_push_dispatch_token(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Real HTTP automation outcome ledger and reconciliation
-- ---------------------------------------------------------------------------
create table if not exists public.automation_runs(
  id bigint generated always as identity primary key,
  job_name text not null,
  request_id bigint,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'DISPATCHED' check(status in ('DISPATCHED','SUCCESS','FAILED','TIMEOUT')),
  http_status integer,
  error_message text,
  metadata jsonb not null default '{}'
);
create unique index if not exists uq_automation_runs_request on public.automation_runs(request_id) where request_id is not null;
create index if not exists idx_automation_runs_open on public.automation_runs(status,started_at) where status='DISPATCHED';
alter table public.automation_runs enable row level security;
revoke all on public.automation_runs from public,anon,authenticated;
grant all on public.automation_runs to service_role;

create or replace function public.reconcile_automation_runs(p_timeout_minutes integer default 5)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_resolved integer:=0; v_timed_out integer:=0;
begin
  if p_timeout_minutes<1 or p_timeout_minutes>120 then raise exception 'Timeout de reconciliação inválido.'; end if;
  with updated as (
    update public.automation_runs a set
      http_status=r.status_code,
      error_message=case when r.error_msg is null then null else pg_catalog.left(r.error_msg,1000) end,
      status=case when r.status_code between 200 and 299 then 'SUCCESS'
                  when r.status_code is null and lower(coalesce(r.error_msg,'')) like '%timeout%' then 'TIMEOUT'
                  else 'FAILED' end,
      finished_at=pg_catalog.now()
    from net._http_response r
    where a.status='DISPATCHED' and a.request_id=r.id
    returning a.id
  ) select count(*) into v_resolved from updated;

  with expired as (
    update public.automation_runs a set status='TIMEOUT',finished_at=pg_catalog.now(),error_message='Resposta HTTP não reconciliada dentro da janela operacional.'
    where a.status='DISPATCHED' and a.started_at<pg_catalog.now()-pg_catalog.make_interval(mins=>p_timeout_minutes)
      and not exists(select 1 from net._http_response r where r.id=a.request_id)
    returning a.id
  ) select count(*) into v_timed_out from expired;
  return pg_catalog.jsonb_build_object('resolved',v_resolved,'timedOut',v_timed_out);
end;$$;
revoke all on function public.reconcile_automation_runs(integer) from public,anon,authenticated;
grant execute on function public.reconcile_automation_runs(integer) to service_role;

create or replace function public.kick_analysis_worker()
returns bigint language plpgsql security definer set search_path=''
as $$
declare next_run_id uuid; next_dispatch_token uuid; request_id bigint;
begin
  select j.run_id,j.dispatch_token into next_run_id,next_dispatch_token
  from public.analysis_jobs j
  where j.status='QUEUED' or (j.status='RUNNING' and (j.lease_expires_at is null or j.lease_expires_at<pg_catalog.now()))
  order by j.created_at limit 1;
  if next_run_id is null then return null; end if;
  select net.http_post(url:='https://quant-football-insights.lovable.app/api/analysis-worker',
    body:=pg_catalog.jsonb_build_object('runId',next_run_id,'dispatchToken',next_dispatch_token),params:='{}'::jsonb,
    headers:=pg_catalog.jsonb_build_object('Content-Type','application/json'),timeout_milliseconds:=120000) into request_id;
  insert into public.automation_runs(job_name,request_id,metadata) values('analysis-worker-watch',request_id,pg_catalog.jsonb_build_object('runId',next_run_id)) on conflict(request_id) do nothing;
  return request_id;
end;$$;
revoke all on function public.kick_analysis_worker() from public,anon,authenticated;
grant execute on function public.kick_analysis_worker() to service_role;

create or replace function public.kick_external_api_maintenance()
returns bigint language plpgsql security definer set search_path=''
as $$
declare v_token uuid; v_request bigint;
begin
  select dispatch_token into v_token from private.external_api_maintenance_config where singleton=true;
  select net.http_post(url:='https://quant-football-insights.lovable.app/api/five-dollar-maintenance',
    body:=pg_catalog.jsonb_build_object('dispatchToken',v_token),params:='{}'::jsonb,
    headers:=pg_catalog.jsonb_build_object('Content-Type','application/json'),timeout_milliseconds:=120000) into v_request;
  insert into public.automation_runs(job_name,request_id,metadata) values('five-dollar-maintenance-daily',v_request,'{}') on conflict(request_id) do nothing;
  return v_request;
end;$$;
revoke all on function public.kick_external_api_maintenance() from public,anon,authenticated;
grant execute on function public.kick_external_api_maintenance() to service_role;

create or replace function public.kick_push_delivery_dispatcher()
returns bigint language plpgsql security definer set search_path=''
as $$
declare v_token uuid; v_request bigint;
begin
  if not exists(select 1 from public.push_delivery_outbox where (status='PENDING' and next_attempt_at<=pg_catalog.now()) or (status='PROCESSING' and locked_at<pg_catalog.now()-interval '2 minutes')) then return null; end if;
  select dispatch_token into v_token from private.push_dispatch_config where singleton=true;
  select net.http_post(url:='https://quant-football-insights.lovable.app/api/push-dispatch',body:='{}'::jsonb,params:='{}'::jsonb,
    headers:=pg_catalog.jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_token::text),timeout_milliseconds:=60000) into v_request;
  insert into public.automation_runs(job_name,request_id,metadata) values('push-delivery-dispatch',v_request,'{}') on conflict(request_id) do nothing;
  return v_request;
end;$$;
revoke all on function public.kick_push_delivery_dispatcher() from public,anon,authenticated;
grant execute on function public.kick_push_delivery_dispatcher() to service_role;

-- Recovery schedulers. Dispatchers are idempotent/claim-based and bounded.
do $$ begin
  if exists(select 1 from cron.job where jobname='push-delivery-dispatch') then perform cron.unschedule('push-delivery-dispatch'); end if;
  if exists(select 1 from cron.job where jobname='automation-http-reconcile') then perform cron.unschedule('automation-http-reconcile'); end if;
end $$;
select cron.schedule('push-delivery-dispatch','* * * * *','select public.kick_push_delivery_dispatcher();');
select cron.schedule('automation-http-reconcile','* * * * *','select public.reconcile_automation_runs(5);');

insert into public.app_schema_releases(version,migration_name,notes)
values('20260912-integrations-automation-resilience','integrations_automation_resilience',
'FiveDollar transient retries, renewable worker leases/fencing, distributed fallback API coordination, durable Web Push outbox, IANA Sao Paulo time semantics and real HTTP automation outcome reconciliation.')
on conflict(version) do update set migration_name=excluded.migration_name,notes=excluded.notes,applied_at=now();
