-- Stage 3 — D+2 background inference runtime reconciliation.
--
-- The scheduled D+2 dispatcher was added after the generic automation conflict
-- fix and accidentally restored ON CONFLICT(request_id). automation_runs uses a
-- partial unique index on request_id, so PostgreSQL cannot infer that index from
-- that conflict target. Keep the same idempotent semantics used by the other
-- dispatchers: bare ON CONFLICT DO NOTHING handles any matching unique rule.

create or replace function public.kick_scheduled_daily_analysis()
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare v_token uuid; v_request bigint;
begin
  if not exists(
    select 1 from private.scheduled_analysis_config c
    where c.singleton=true and c.enabled=true
  ) then
    return null;
  end if;

  select dispatch_token into v_token
  from private.external_api_maintenance_config
  where singleton=true;
  if v_token is null then return null; end if;

  select net.http_post(
    url:='https://quant-football-insights.lovable.app/api/five-dollar-maintenance',
    body:=pg_catalog.jsonb_build_object('dispatchToken',v_token,'action','DAILY_D2_ANALYSIS'),
    params:='{}'::jsonb,
    headers:=pg_catalog.jsonb_build_object('Content-Type','application/json'),
    timeout_milliseconds:=120000
  ) into v_request;

  insert into public.automation_runs(job_name,request_id,metadata)
  values('scheduled-d2-analysis',v_request,pg_catalog.jsonb_build_object('localZone','America/Sao_Paulo'))
  on conflict do nothing;
  return v_request;
end;
$$;

revoke all on function public.kick_scheduled_daily_analysis() from public,anon,authenticated;
grant execute on function public.kick_scheduled_daily_analysis() to service_role;

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260913-stage3-d2-background-inference',
  'stage3_d2_background_inference',
  'Reconciles the scheduled D+2 dispatcher with the partial request-id uniqueness rule. Application code for the same release persists predictions in the background before READY_FOR_ODDS.'
)
on conflict(version) do update
set migration_name=excluded.migration_name,
    notes=excluded.notes,
    applied_at=pg_catalog.now();
