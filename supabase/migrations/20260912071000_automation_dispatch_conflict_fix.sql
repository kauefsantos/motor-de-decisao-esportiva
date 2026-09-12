-- Runtime fix discovered by production smoke testing.
-- automation_runs.request_id uses a partial unique index, so PostgreSQL cannot
-- infer it from ON CONFLICT(request_id). Bare ON CONFLICT DO NOTHING safely
-- handles any unique conflict while preserving the partial-index design.

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
  insert into public.automation_runs(job_name,request_id,metadata)
  values('analysis-worker-watch',request_id,pg_catalog.jsonb_build_object('runId',next_run_id))
  on conflict do nothing;
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
  insert into public.automation_runs(job_name,request_id,metadata)
  values('five-dollar-maintenance-daily',v_request,'{}')
  on conflict do nothing;
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
  insert into public.automation_runs(job_name,request_id,metadata)
  values('push-delivery-dispatch',v_request,'{}')
  on conflict do nothing;
  return v_request;
end;$$;
revoke all on function public.kick_push_delivery_dispatcher() from public,anon,authenticated;
grant execute on function public.kick_push_delivery_dispatcher() to service_role;

insert into public.app_schema_releases(version,migration_name,notes)
values('20260912-automation-dispatch-conflict-fix','automation_dispatch_conflict_fix',
'Production smoke fix: dispatch ledgers use bare ON CONFLICT DO NOTHING because request_id uniqueness is enforced by a partial unique index.')
on conflict(version) do update set migration_name=excluded.migration_name,notes=excluded.notes,applied_at=now();