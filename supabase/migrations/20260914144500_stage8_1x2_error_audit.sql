-- Stage 8: deep 1X2 error audit. Audit-only infrastructure.
-- It deliberately does not mutate model_versions, promote models, start holdout,
-- relax calibration thresholds, or authorize real stake.

create table if not exists private.model_error_audit_artifacts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references private.model_validation_jobs(id) on delete cascade,
  market_family text not null,
  model_version text not null,
  protocol_version text not null,
  audit_version text not null,
  window_start date,
  window_end_exclusive date,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now()
);

revoke all on table private.model_error_audit_artifacts from public,anon,authenticated;
grant select,insert on table private.model_error_audit_artifacts to service_role;

create index if not exists model_error_audit_artifacts_lookup_idx
  on private.model_error_audit_artifacts(market_family,model_version,created_at desc);

create or replace function public.complete_stage8_model_error_audit(
  p_job_id uuid,
  p_dispatch_token uuid,
  p_report jsonb,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_family text;
  v_model text;
  v_protocol text;
  v_changed integer:=0;
begin
  select j.market_family,j.target_model_version,j.protocol_version
    into v_family,v_model,v_protocol
  from private.model_validation_jobs j
  where j.id=p_job_id
    and j.dispatch_token=p_dispatch_token
    and j.status='RUNNING'
  for update;

  if v_model is null or v_protocol<>'stage8-1x2-error-audit-v1' then
    return false;
  end if;

  update private.model_validation_jobs j
     set status=case when p_error is null then 'DONE' else 'ERROR' end,
         report=case when p_error is null then coalesce(p_report,'{}'::jsonb) else j.report end,
         last_error=case when p_error is null then null else pg_catalog.left(p_error,1000) end,
         completed_at=pg_catalog.now(),
         updated_at=pg_catalog.now()
   where j.id=p_job_id
     and j.dispatch_token=p_dispatch_token
     and j.status='RUNNING';
  get diagnostics v_changed=row_count;
  if v_changed<>1 then return false; end if;

  if p_error is null then
    insert into private.model_error_audit_artifacts(
      job_id,market_family,model_version,protocol_version,audit_version,
      window_start,window_end_exclusive,report
    ) values(
      p_job_id,
      v_family,
      v_model,
      v_protocol,
      coalesce(nullif(p_report->>'auditVersion',''),'stage8-error-audit-unknown'),
      nullif(p_report#>>'{window,startInclusive}','')::date,
      nullif(p_report#>>'{window,endExclusive}','')::date,
      coalesce(p_report,'{}'::jsonb)
    );
  end if;

  return true;
end;
$$;

revoke all on function public.complete_stage8_model_error_audit(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.complete_stage8_model_error_audit(uuid,uuid,jsonb,text) to service_role;

create or replace function public.kick_stage8_1x2_error_audit()
returns table(job_id uuid,request_id bigint)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job_id uuid;
  v_token uuid;
  v_request_id bigint;
begin
  if not exists(
    select 1
    from public.model_versions mv
    where mv.market_family='1X2'
      and mv.model_version='goals-baseline-v2-recency+elo-v1-w020'
      and mv.calibration_version is null
  ) then
    raise exception 'Stage 8 benchmark model is not registered.';
  end if;

  select j.id into v_job_id
  from private.model_validation_jobs j
  where j.market_family='1X2'
    and j.target_model_version='goals-baseline-v2-recency+elo-v1-w020'
    and j.target_calibration_version is null
    and j.protocol_version='stage8-1x2-error-audit-v1'
    and j.status in ('QUEUED','RUNNING')
  order by j.created_at desc
  limit 1;

  if v_job_id is not null then
    return query select v_job_id,null::bigint;
    return;
  end if;

  insert into private.model_validation_jobs(
    market_family,target_model_version,target_calibration_version,protocol_version,status
  ) values(
    '1X2','goals-baseline-v2-recency+elo-v1-w020',null,'stage8-1x2-error-audit-v1','QUEUED'
  ) returning id,dispatch_token into v_job_id,v_token;

  select net.http_post(
    url:='https://quant-football-insights.lovable.app/api/model-validation',
    body:=pg_catalog.jsonb_build_object('jobId',v_job_id,'dispatchToken',v_token),
    params:='{}'::jsonb,
    headers:=pg_catalog.jsonb_build_object('Content-Type','application/json'),
    timeout_milliseconds:=120000
  ) into v_request_id;

  insert into public.automation_runs(job_name,request_id,metadata)
  values(
    'stage8-1x2-error-audit',
    v_request_id,
    pg_catalog.jsonb_build_object(
      'jobId',v_job_id,
      'marketFamily','1X2',
      'targetModelVersion','goals-baseline-v2-recency+elo-v1-w020',
      'protocolVersion','stage8-1x2-error-audit-v1',
      'auditOnly',true,
      'promotionAttempted',false
    )
  )
  on conflict do nothing;

  return query select v_job_id,v_request_id;
end;
$$;

revoke all on function public.kick_stage8_1x2_error_audit() from public,anon,authenticated;
grant execute on function public.kick_stage8_1x2_error_audit() to service_role;

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260914-stage8-1x2-error-audit',
  'stage8_1x2_error_audit',
  'Adds immutable audit-only evidence storage and a worker kick for the Stage 8 1X2 deep error audit. The benchmark formula, calibration tolerance, model status, prospective holdout and real-stake authorization remain unchanged.'
)
on conflict(version) do update
set migration_name=excluded.migration_name,notes=excluded.notes,applied_at=pg_catalog.now();
