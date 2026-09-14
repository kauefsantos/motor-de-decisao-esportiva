-- Stage 9 — governed calibration for the exact uncertainty-linear 40% domestic 1X2 runtime.
-- Retrospective calibration can only reach SHADOW_READY. PRODUCTION_VALIDATED is
-- possible exclusively after the untouched prospective holdout (>=200 fixtures)
-- has passed every canonical scoring, calibration and stability gate.

insert into public.model_versions(
  market_family,model_version,calibration_version,validation_status,out_of_sample_metrics
)
select
  '1X2',
  'goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040',
  'stage9-ensemble-calibration-v1-fit-through-2026-05-31',
  'NOT_PRODUCTION_VALIDATED',
  pg_catalog.jsonb_build_object(
    'stage','STAGE9_PENDING',
    'protocolVersion','stage9-1x2-ensemble-calibration-v1',
    'productionValidated',false
  )
where not exists(
  select 1 from public.model_versions mv
  where mv.market_family='1X2'
    and mv.model_version='goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040'
    and mv.calibration_version='stage9-ensemble-calibration-v1-fit-through-2026-05-31'
);

create or replace function public.store_stage9_calibration_artifact(
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
     or p_model_version<>'goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040'
     or p_calibration_version<>'stage9-ensemble-calibration-v1-fit-through-2026-05-31' then
    raise exception 'Unsupported Stage 9 calibration artifact.';
  end if;
  if p_status not in ('REJECTED','SHADOW_READY') then
    raise exception 'Invalid Stage 9 calibration status.';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(p_report,'{}'::jsonb))<>'object' then
    raise exception 'Stage 9 report must be a JSON object.';
  end if;
  if p_status='SHADOW_READY' and (
    pg_catalog.jsonb_typeof(coalesce(p_parameters,'{}'::jsonb))<>'object'
    or coalesce(p_report->>'readinessStatus','')<>'SHADOW_READY'
    or coalesce((p_report#>>'{retrospective,acceptance,calibrationWithinTolerance}')::boolean,false) is not true
    or coalesce((p_report#>>'{retrospective,acceptance,doesNotDegradeRawBrier}')::boolean,false) is not true
    or coalesce((p_report#>>'{retrospective,acceptance,doesNotDegradeRawLogLoss}')::boolean,false) is not true
    or coalesce((p_report#>>'{retrospective,acceptance,temporalStability}')::boolean,false) is not true
    or coalesce((p_report#>>'{retrospective,acceptance,leagueStability}')::boolean,false) is not true
    or coalesce((p_report#>>'{retrospective,acceptance,noLeakage}')::boolean,false) is not true
    or coalesce((p_report#>>'{retrospective,calibratedMetrics,maxCalibrationGap}')::numeric,1)>0.10
  ) then
    raise exception 'Stage 9 SHADOW_READY requires every retrospective gate to pass.';
  end if;

  insert into private.model_calibration_artifacts(
    market_family,model_version,calibration_version,method,parameters,status,fit_report,holdout_report,prospective_holdout_start
  ) values(
    p_market_family,p_model_version,p_calibration_version,
    coalesce(nullif(p_parameters->>'kind',''),'stage9_calibration'),
    coalesce(p_parameters,'{}'::jsonb),p_status,coalesce(p_report,'{}'::jsonb),'{}'::jsonb,date '2026-09-14'
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
revoke all on function public.store_stage9_calibration_artifact(text,text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.store_stage9_calibration_artifact(text,text,text,text,jsonb,jsonb) to service_role;

create or replace function public.get_stage9_active_calibration(
  p_market_family text,
  p_model_version text
)
returns table(
  calibration_version text,
  status text,
  parameters jsonb,
  fit_report jsonb,
  validation_status text
)
language sql
security definer
set search_path=''
stable
as $$
  select
    a.calibration_version,
    a.status,
    a.parameters,
    a.fit_report,
    coalesce((
      select mv.validation_status
      from public.model_versions mv
      where mv.market_family=a.market_family
        and mv.model_version=a.model_version
        and mv.calibration_version=a.calibration_version
      order by mv.created_at desc
      limit 1
    ),'NOT_PRODUCTION_VALIDATED') as validation_status
  from private.model_calibration_artifacts a
  where a.market_family=p_market_family
    and a.model_version=p_model_version
    and a.calibration_version='stage9-ensemble-calibration-v1-fit-through-2026-05-31'
    and a.status in ('SHADOW_READY','HOLDOUT_PASSED')
  order by a.updated_at desc
  limit 1
$$;
revoke all on function public.get_stage9_active_calibration(text,text) from public,anon,authenticated;
grant execute on function public.get_stage9_active_calibration(text,text) to service_role;

create or replace function public.update_stage9_holdout_artifact(
  p_market_family text,
  p_model_version text,
  p_calibration_version text,
  p_status text,
  p_holdout_report jsonb
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare v_changed integer;
begin
  if p_market_family<>'1X2'
     or p_model_version<>'goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040'
     or p_calibration_version<>'stage9-ensemble-calibration-v1-fit-through-2026-05-31' then
    raise exception 'Unsupported Stage 9 holdout artifact.';
  end if;
  if p_status not in ('SHADOW_READY','HOLDOUT_FAILED','HOLDOUT_PASSED') then
    raise exception 'Invalid Stage 9 holdout status.';
  end if;
  if p_status='HOLDOUT_PASSED' and (
    coalesce(p_holdout_report->>'readinessStatus','')<>'HOLDOUT_PASSED'
    or coalesce((p_holdout_report#>>'{prospectiveHoldout,sampleSize}')::integer,0)<200
    or coalesce((p_holdout_report#>>'{prospectiveHoldout,acceptance,enoughData}')::boolean,false) is not true
    or coalesce((p_holdout_report#>>'{prospectiveHoldout,acceptance,improvesOrPreservesBrier}')::boolean,false) is not true
    or coalesce((p_holdout_report#>>'{prospectiveHoldout,acceptance,improvesOrPreservesLogLoss}')::boolean,false) is not true
    or coalesce((p_holdout_report#>>'{prospectiveHoldout,acceptance,calibrationWithinTolerance}')::boolean,false) is not true
    or coalesce((p_holdout_report#>>'{prospectiveHoldout,acceptance,enoughStabilityCoverage}')::boolean,false) is not true
    or coalesce((p_holdout_report#>>'{prospectiveHoldout,acceptance,leagueStability}')::boolean,false) is not true
    or coalesce((p_holdout_report#>>'{prospectiveHoldout,acceptance,noLeakage}')::boolean,false) is not true
    or coalesce((p_holdout_report#>>'{prospectiveHoldout,calibratedMetrics,maxCalibrationGap}')::numeric,1)>0.10
  ) then
    raise exception 'Stage 9 HOLDOUT_PASSED requires every prospective gate to pass.';
  end if;

  update private.model_calibration_artifacts a
     set status=p_status,
         holdout_report=coalesce(p_holdout_report,'{}'::jsonb),
         updated_at=pg_catalog.now()
   where a.market_family=p_market_family
     and a.model_version=p_model_version
     and a.calibration_version=p_calibration_version
     and a.status in ('SHADOW_READY','HOLDOUT_PASSED');
  get diagnostics v_changed=row_count;
  if v_changed<>1 then return false; end if;

  update public.model_versions mv
     set validation_status=case when p_status='HOLDOUT_PASSED' then 'HOLDOUT_PASSED' else 'NOT_PRODUCTION_VALIDATED' end,
         out_of_sample_metrics=coalesce(p_holdout_report,'{}'::jsonb)
   where mv.market_family=p_market_family
     and mv.model_version=p_model_version
     and mv.calibration_version=p_calibration_version;
  return true;
end;
$$;
revoke all on function public.update_stage9_holdout_artifact(text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.update_stage9_holdout_artifact(text,text,text,text,jsonb) to service_role;

create or replace function public.get_stage9_1x2_holdout_rows_page(
  p_after_prediction_at timestamptz default null,
  p_after_prediction_id text default null,
  p_limit integer default 900
)
returns table(
  fixture_id bigint,
  prediction_id text,
  prediction_at timestamptz,
  fixture_date date,
  league text,
  side text,
  raw_probability numeric,
  calibrated_probability numeric,
  home_goals integer,
  away_goals integer
)
language sql
security definer
set search_path=''
stable
as $$
  select
    x.external_id::bigint as fixture_id,
    mp.prediction_id,
    mp.prediction_at,
    fm.fixture_date,
    coalesce(m.competition,'unknown') as league,
    mp.side,
    mp.model_probability as raw_probability,
    mp.p_cal as calibrated_probability,
    fm.home_goals,
    fm.away_goals
  from public.model_predictions mp
  join public.matches m on m.id=mp.match_id and m.run_id=mp.run_id
  join public.match_external_ids x on x.match_id=mp.match_id and x.source='five_dollar_fixture' and x.external_id ~ '^[0-9]+$'
  join private.five_dollar_model_matches fm on fm.fixture_id=x.external_id::bigint
  where mp.market='1x2'
    and mp.model_version='goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040'
    and mp.calibration_version='stage9-ensemble-calibration-v1-fit-through-2026-05-31'
    and mp.p_cal is not null
    and mp.model_probability is not null
    and mp.side in ('HOME','DRAW','AWAY')
    and mp.prediction_at::date>=date '2026-09-14'
    and fm.fixture_date>=date '2026-09-14'
    and mp.prediction_at::date<fm.fixture_date
    and fm.has_conflict=false
    and fm.home_goals is not null
    and fm.away_goals is not null
    and (
      p_after_prediction_at is null
      or mp.prediction_at>p_after_prediction_at
      or (mp.prediction_at=p_after_prediction_at and mp.prediction_id>coalesce(p_after_prediction_id,''))
    )
  order by mp.prediction_at,mp.prediction_id
  limit greatest(1,least(coalesce(p_limit,900),900))
$$;
revoke all on function public.get_stage9_1x2_holdout_rows_page(timestamptz,text,integer) from public,anon,authenticated;
grant execute on function public.get_stage9_1x2_holdout_rows_page(timestamptz,text,integer) to service_role;

create or replace function public.promote_stage9_1x2_if_holdout_passed()
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_fit jsonb;
  v_holdout jsonb;
  v_status text;
  v_changed integer;
begin
  select a.fit_report,a.holdout_report,a.status
    into v_fit,v_holdout,v_status
  from private.model_calibration_artifacts a
  where a.market_family='1X2'
    and a.model_version='goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040'
    and a.calibration_version='stage9-ensemble-calibration-v1-fit-through-2026-05-31'
  for update;

  if v_status is distinct from 'HOLDOUT_PASSED' then return false; end if;
  if coalesce(v_fit->>'readinessStatus','')<>'SHADOW_READY'
     or coalesce(v_holdout->>'readinessStatus','')<>'HOLDOUT_PASSED'
     or coalesce((v_fit#>>'{retrospective,acceptance,calibrationWithinTolerance}')::boolean,false) is not true
     or coalesce((v_fit#>>'{retrospective,acceptance,doesNotDegradeRawBrier}')::boolean,false) is not true
     or coalesce((v_fit#>>'{retrospective,acceptance,doesNotDegradeRawLogLoss}')::boolean,false) is not true
     or coalesce((v_fit#>>'{retrospective,acceptance,temporalStability}')::boolean,false) is not true
     or coalesce((v_fit#>>'{retrospective,acceptance,leagueStability}')::boolean,false) is not true
     or coalesce((v_fit#>>'{retrospective,acceptance,noLeakage}')::boolean,false) is not true
     or coalesce((v_holdout#>>'{prospectiveHoldout,sampleSize}')::integer,0)<200
     or coalesce((v_holdout#>>'{prospectiveHoldout,acceptance,enoughData}')::boolean,false) is not true
     or coalesce((v_holdout#>>'{prospectiveHoldout,acceptance,improvesOrPreservesBrier}')::boolean,false) is not true
     or coalesce((v_holdout#>>'{prospectiveHoldout,acceptance,improvesOrPreservesLogLoss}')::boolean,false) is not true
     or coalesce((v_holdout#>>'{prospectiveHoldout,acceptance,calibrationWithinTolerance}')::boolean,false) is not true
     or coalesce((v_holdout#>>'{prospectiveHoldout,acceptance,enoughStabilityCoverage}')::boolean,false) is not true
     or coalesce((v_holdout#>>'{prospectiveHoldout,acceptance,leagueStability}')::boolean,false) is not true
     or coalesce((v_holdout#>>'{prospectiveHoldout,acceptance,noLeakage}')::boolean,false) is not true
     or coalesce((v_fit#>>'{retrospective,calibratedMetrics,maxCalibrationGap}')::numeric,1)>0.10
     or coalesce((v_holdout#>>'{prospectiveHoldout,calibratedMetrics,maxCalibrationGap}')::numeric,1)>0.10
  then
    raise exception 'Stage 9 promotion prerequisites are incomplete or failed.';
  end if;

  update public.model_versions mv
     set validation_status='PRODUCTION_VALIDATED',
         out_of_sample_metrics=pg_catalog.jsonb_build_object(
           'stage','STAGE9',
           'productionValidated',true,
           'retrospective',v_fit->'retrospective',
           'prospectiveHoldout',v_holdout->'prospectiveHoldout'
         )
   where mv.market_family='1X2'
     and mv.model_version='goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040'
     and mv.calibration_version='stage9-ensemble-calibration-v1-fit-through-2026-05-31';
  get diagnostics v_changed=row_count;
  return v_changed=1;
end;
$$;
revoke all on function public.promote_stage9_1x2_if_holdout_passed() from public,anon,authenticated;
grant execute on function public.promote_stage9_1x2_if_holdout_passed() to service_role;

create or replace function public.kick_stage9_1x2_calibration()
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
      and mv.model_version='goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040'
      and mv.calibration_version='stage9-ensemble-calibration-v1-fit-through-2026-05-31'
  ) then raise exception 'Stage 9 model registry artifact is missing.'; end if;

  select j.id into v_job_id
  from private.model_validation_jobs j
  where j.market_family='1X2'
    and j.target_model_version='goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040'
    and j.target_calibration_version='stage9-ensemble-calibration-v1-fit-through-2026-05-31'
    and j.protocol_version='stage9-1x2-ensemble-calibration-v1'
    and j.status in ('QUEUED','RUNNING')
  order by j.created_at desc limit 1;
  if v_job_id is not null then return query select v_job_id,null::bigint; return; end if;

  insert into private.model_validation_jobs(market_family,target_model_version,target_calibration_version,protocol_version,status)
  values('1X2','goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040','stage9-ensemble-calibration-v1-fit-through-2026-05-31','stage9-1x2-ensemble-calibration-v1','QUEUED')
  returning id,dispatch_token into v_job_id,v_token;

  select net.http_post(
    url:='https://quant-football-insights.lovable.app/api/model-validation',
    body:=pg_catalog.jsonb_build_object('jobId',v_job_id,'dispatchToken',v_token),
    params:='{}'::jsonb,
    headers:=pg_catalog.jsonb_build_object('Content-Type','application/json'),
    timeout_milliseconds:=120000
  ) into v_request_id;
  insert into public.automation_runs(job_name,request_id,metadata)
  values('stage9-1x2-calibration',v_request_id,pg_catalog.jsonb_build_object('jobId',v_job_id,'protocolVersion','stage9-1x2-ensemble-calibration-v1'))
  on conflict do nothing;
  return query select v_job_id,v_request_id;
end;
$$;
revoke all on function public.kick_stage9_1x2_calibration() from public,anon,authenticated;
grant execute on function public.kick_stage9_1x2_calibration() to service_role;

create or replace function public.kick_stage9_1x2_holdout()
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
      and a.model_version='goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040'
      and a.calibration_version='stage9-ensemble-calibration-v1-fit-through-2026-05-31'
      and a.status in ('SHADOW_READY','HOLDOUT_PASSED')
  ) then raise exception 'Stage 9 holdout requires a frozen SHADOW_READY calibrator.'; end if;

  select j.id into v_job_id
  from private.model_validation_jobs j
  where j.market_family='1X2'
    and j.target_model_version='goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040'
    and j.target_calibration_version='stage9-ensemble-calibration-v1-fit-through-2026-05-31'
    and j.protocol_version='stage9-1x2-ensemble-prospective-holdout-v1'
    and j.status in ('QUEUED','RUNNING')
  order by j.created_at desc limit 1;
  if v_job_id is not null then return query select v_job_id,null::bigint; return; end if;

  insert into private.model_validation_jobs(market_family,target_model_version,target_calibration_version,protocol_version,status)
  values('1X2','goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040','stage9-ensemble-calibration-v1-fit-through-2026-05-31','stage9-1x2-ensemble-prospective-holdout-v1','QUEUED')
  returning id,dispatch_token into v_job_id,v_token;

  select net.http_post(
    url:='https://quant-football-insights.lovable.app/api/model-validation',
    body:=pg_catalog.jsonb_build_object('jobId',v_job_id,'dispatchToken',v_token),
    params:='{}'::jsonb,
    headers:=pg_catalog.jsonb_build_object('Content-Type','application/json'),
    timeout_milliseconds:=120000
  ) into v_request_id;
  insert into public.automation_runs(job_name,request_id,metadata)
  values('stage9-1x2-holdout',v_request_id,pg_catalog.jsonb_build_object('jobId',v_job_id,'protocolVersion','stage9-1x2-ensemble-prospective-holdout-v1'))
  on conflict do nothing;
  return query select v_job_id,v_request_id;
end;
$$;
revoke all on function public.kick_stage9_1x2_holdout() from public,anon,authenticated;
grant execute on function public.kick_stage9_1x2_holdout() to service_role;

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260914-stage9-1x2-ensemble-calibration',
  'stage9_1x2_ensemble_calibration',
  'Stage 9 calibrates the frozen uncertainty-linear 40% domestic 1X2 model. Retrospective SHADOW_READY requires <=10pp max calibration gap without degrading Brier/LogLoss and with temporal/league stability. PRODUCTION_VALIDATED can only be set after >=200 untouched prospective fixtures pass every holdout gate.'
)
on conflict(version) do update
set migration_name=excluded.migration_name,notes=excluded.notes,applied_at=pg_catalog.now();
