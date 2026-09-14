-- Stage 7C — joint multiclass calibration for the exact domestic 1X2 + Elo artifact.
-- Never promotes to PRODUCTION_VALIDATED and never authorizes positive stake.

insert into public.model_versions(
  market_family,model_version,calibration_version,validation_status,out_of_sample_metrics
)
select
  '1X2',
  'goals-baseline-v2-recency+elo-v1-w020',
  'joint-logit-v1-fit-through-2026-05-31',
  'NOT_PRODUCTION_VALIDATED',
  pg_catalog.jsonb_build_object(
    'stage','STAGE7C_PENDING',
    'protocolVersion','stage7c-1x2-joint-calibration-v1',
    'productionValidated',false
  )
where not exists(
  select 1 from public.model_versions mv
  where mv.market_family='1X2'
    and mv.model_version='goals-baseline-v2-recency+elo-v1-w020'
    and mv.calibration_version='joint-logit-v1-fit-through-2026-05-31'
);

create or replace function public.store_stage7c_calibration_artifact(
  p_market_family text,
  p_model_version text,
  p_calibration_version text,
  p_status text,
  p_parameters jsonb,
  p_report jsonb
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_market_family<>'1X2'
     or p_model_version<>'goals-baseline-v2-recency+elo-v1-w020'
     or p_calibration_version<>'joint-logit-v1-fit-through-2026-05-31' then
    raise exception 'Unsupported Stage 7C calibration artifact.';
  end if;
  if p_status not in ('REJECTED','SHADOW_READY') then
    raise exception 'Invalid Stage 7C calibration status.';
  end if;
  if p_status='SHADOW_READY' and (
    pg_catalog.jsonb_typeof(coalesce(p_parameters,'{}'::jsonb))<>'object'
    or coalesce(p_parameters->>'kind','')<>'joint_multiclass_logit'
    or coalesce(p_parameters->>'family','') not in ('vector_scaling','dirichlet')
    or not (p_parameters ? 'lambda')
    or not (p_parameters ? 'blend')
    or not (p_parameters ? 'scales')
    or not (p_parameters ? 'weights')
    or not (p_parameters ? 'bias')
    or (p_parameters->>'lambda')::numeric<0
    or (p_parameters->>'blend')::numeric<0
    or (p_parameters->>'blend')::numeric>1
    or pg_catalog.jsonb_typeof(p_parameters->'scales')<>'object'
    or pg_catalog.jsonb_typeof(p_parameters->'weights')<>'object'
    or pg_catalog.jsonb_typeof(p_parameters->'bias')<>'object'
  ) then
    raise exception 'Stage 7C SHADOW_READY requires a valid frozen joint calibration artifact.';
  end if;

  insert into private.model_calibration_artifacts(
    market_family,model_version,calibration_version,method,parameters,status,fit_report,holdout_report,prospective_holdout_start
  ) values(
    p_market_family,p_model_version,p_calibration_version,'joint_multiclass_logit',coalesce(p_parameters,'{}'::jsonb),p_status,
    coalesce(p_report,'{}'::jsonb),'{}'::jsonb,date '2026-09-14'
  )
  on conflict(market_family,model_version,calibration_version) do update
    set method=excluded.method,
        parameters=excluded.parameters,
        status=excluded.status,
        fit_report=excluded.fit_report,
        holdout_report='{}'::jsonb,
        prospective_holdout_start=excluded.prospective_holdout_start,
        updated_at=pg_catalog.now();

  update public.model_versions mv
     set validation_status='NOT_PRODUCTION_VALIDATED',
         out_of_sample_metrics=coalesce(p_report,'{}'::jsonb)
   where mv.market_family=p_market_family
     and mv.model_version=p_model_version
     and mv.calibration_version=p_calibration_version;

  return true;
end;
$$;
revoke all on function public.store_stage7c_calibration_artifact(text,text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.store_stage7c_calibration_artifact(text,text,text,text,jsonb,jsonb) to service_role;

create or replace function public.kick_stage7c_1x2_calibration()
returns table(job_id uuid,request_id bigint)
language plpgsql
security definer
set search_path=''
as $$
declare v_job_id uuid; v_token uuid; v_request_id bigint;
begin
  if not exists(
    select 1 from public.model_versions mv
    where mv.market_family='1X2'
      and mv.model_version='goals-baseline-v2-recency+elo-v1-w020'
      and mv.calibration_version='joint-logit-v1-fit-through-2026-05-31'
  ) then raise exception 'Stage 7C calibrated registry artifact is missing.'; end if;

  select j.id into v_job_id
  from private.model_validation_jobs j
  where j.market_family='1X2'
    and j.target_model_version='goals-baseline-v2-recency+elo-v1-w020'
    and j.target_calibration_version='joint-logit-v1-fit-through-2026-05-31'
    and j.protocol_version='stage7c-1x2-joint-calibration-v1'
    and j.status in ('QUEUED','RUNNING')
  order by j.created_at desc limit 1;
  if v_job_id is not null then return query select v_job_id,null::bigint; return; end if;

  insert into private.model_validation_jobs(market_family,target_model_version,target_calibration_version,protocol_version,status)
  values('1X2','goals-baseline-v2-recency+elo-v1-w020','joint-logit-v1-fit-through-2026-05-31','stage7c-1x2-joint-calibration-v1','QUEUED')
  returning id,dispatch_token into v_job_id,v_token;

  select net.http_post(
    url:='https://quant-football-insights.lovable.app/api/model-validation',
    body:=pg_catalog.jsonb_build_object('jobId',v_job_id,'dispatchToken',v_token),
    params:='{}'::jsonb,
    headers:=pg_catalog.jsonb_build_object('Content-Type','application/json'),
    timeout_milliseconds:=120000
  ) into v_request_id;
  insert into public.automation_runs(job_name,request_id,metadata)
  values('stage7c-1x2-calibration',v_request_id,pg_catalog.jsonb_build_object('jobId',v_job_id,'protocolVersion','stage7c-1x2-joint-calibration-v1'))
  on conflict do nothing;
  return query select v_job_id,v_request_id;
end;
$$;
revoke all on function public.kick_stage7c_1x2_calibration() from public,anon,authenticated;
grant execute on function public.kick_stage7c_1x2_calibration() to service_role;

create or replace function public.kick_stage7c_1x2_holdout()
returns table(job_id uuid,request_id bigint)
language plpgsql
security definer
set search_path=''
as $$
declare v_job_id uuid; v_token uuid; v_request_id bigint;
begin
  if not exists(
    select 1 from private.model_calibration_artifacts a
    where a.market_family='1X2'
      and a.model_version='goals-baseline-v2-recency+elo-v1-w020'
      and a.calibration_version='joint-logit-v1-fit-through-2026-05-31'
      and a.status in ('SHADOW_READY','HOLDOUT_PASSED')
  ) then raise exception 'Stage 7C holdout requires a frozen SHADOW_READY calibrator.'; end if;

  select j.id into v_job_id
  from private.model_validation_jobs j
  where j.market_family='1X2'
    and j.target_model_version='goals-baseline-v2-recency+elo-v1-w020'
    and j.target_calibration_version='joint-logit-v1-fit-through-2026-05-31'
    and j.protocol_version='stage7c-1x2-prospective-holdout-v1'
    and j.status in ('QUEUED','RUNNING')
  order by j.created_at desc limit 1;
  if v_job_id is not null then return query select v_job_id,null::bigint; return; end if;

  insert into private.model_validation_jobs(market_family,target_model_version,target_calibration_version,protocol_version,status)
  values('1X2','goals-baseline-v2-recency+elo-v1-w020','joint-logit-v1-fit-through-2026-05-31','stage7c-1x2-prospective-holdout-v1','QUEUED')
  returning id,dispatch_token into v_job_id,v_token;

  select net.http_post(
    url:='https://quant-football-insights.lovable.app/api/model-validation',
    body:=pg_catalog.jsonb_build_object('jobId',v_job_id,'dispatchToken',v_token),
    params:='{}'::jsonb,
    headers:=pg_catalog.jsonb_build_object('Content-Type','application/json'),
    timeout_milliseconds:=120000
  ) into v_request_id;
  insert into public.automation_runs(job_name,request_id,metadata)
  values('stage7c-1x2-holdout',v_request_id,pg_catalog.jsonb_build_object('jobId',v_job_id,'protocolVersion','stage7c-1x2-prospective-holdout-v1'))
  on conflict do nothing;
  return query select v_job_id,v_request_id;
end;
$$;
revoke all on function public.kick_stage7c_1x2_holdout() from public,anon,authenticated;
grant execute on function public.kick_stage7c_1x2_holdout() to service_role;

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260914-stage7c-1x2-joint-calibration',
  'stage7c_1x2_joint_calibration',
  'Adds regularized vector/Dirichlet joint multiclass calibration and an untouched prospective holdout for exact domestic 1X2+Elo. Never promotes to PRODUCTION_VALIDATED or authorizes stake.'
)
on conflict(version) do update
set migration_name=excluded.migration_name,notes=excluded.notes,applied_at=pg_catalog.now();
