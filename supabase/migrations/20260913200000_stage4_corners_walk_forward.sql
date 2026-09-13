-- Stage 4: execute a point-in-time walk-forward validation of the exact
-- domestic corners runtime artifacts without promoting any model.

create table if not exists private.model_validation_jobs (
  id uuid primary key default gen_random_uuid(),
  market_family text not null,
  target_model_version text not null,
  protocol_version text not null,
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','DONE','ERROR')),
  dispatch_token uuid not null default gen_random_uuid(),
  report jsonb,
  last_error text,
  created_at timestamptz not null default pg_catalog.now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default pg_catalog.now()
);

revoke all on table private.model_validation_jobs from public,anon,authenticated;
grant select,insert,update on table private.model_validation_jobs to service_role;

insert into public.model_versions(
  market_family,model_version,calibration_version,validation_status,out_of_sample_metrics
)
select
  'CORNERS','corners-negbin-v2+nb2',null,'NOT_PRODUCTION_VALIDATED',
  pg_catalog.jsonb_build_object(
    'stage4Status','PENDING_WALK_FORWARD',
    'protocolVersion','stage4-corners-walk-forward-v1',
    'note','Exact domestic runtime artifact registered for Stage 4 validation; not production authorized.'
  )
where not exists (
  select 1 from public.model_versions
  where market_family='CORNERS' and model_version='corners-negbin-v2+nb2'
);

insert into public.model_versions(
  market_family,model_version,calibration_version,validation_status,out_of_sample_metrics
)
select
  'CORNERS','corners-negbin-v2+poisson',null,'NOT_PRODUCTION_VALIDATED',
  pg_catalog.jsonb_build_object(
    'stage4Status','FALLBACK_ARTIFACT',
    'protocolVersion','stage4-corners-walk-forward-v1',
    'note','Poisson fallback emitted by the same runtime policy when NB2 is not eligible; no production authorization.'
  )
where not exists (
  select 1 from public.model_versions
  where market_family='CORNERS' and model_version='corners-negbin-v2+poisson'
);

create or replace function public.get_stage4_corners_validation_rows()
returns table(
  fixture_id bigint,
  fixture_date date,
  league text,
  home_team_id bigint,
  away_team_id bigint,
  home_corners numeric,
  away_corners numeric
)
language sql
stable
security definer
set search_path=''
as $$
  select
    m.fixture_id,
    m.fixture_date,
    pg_catalog.split_part(m.external_match_id, ':', 1) as league,
    m.home_team_id,
    m.away_team_id,
    m.home_corners,
    m.away_corners
  from private.five_dollar_model_matches m
  where m.has_conflict=false
    and m.fixture_date is not null
    and m.fixture_date < (pg_catalog.now() at time zone 'America/Sao_Paulo')::date
    and m.external_match_id is not null
    and m.home_team_id is not null
    and m.away_team_id is not null
    and m.home_corners is not null
    and m.away_corners is not null
  order by m.fixture_date,m.fixture_id;
$$;

revoke all on function public.get_stage4_corners_validation_rows() from public,anon,authenticated;
grant execute on function public.get_stage4_corners_validation_rows() to service_role;

create or replace function public.claim_stage4_model_validation(
  p_job_id uuid,
  p_dispatch_token uuid
)
returns table(accepted boolean,target_model_version text)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_changed integer:=0;
  v_target text;
begin
  update private.model_validation_jobs j
     set status='RUNNING',started_at=pg_catalog.now(),updated_at=pg_catalog.now(),last_error=null
   where j.id=p_job_id
     and j.dispatch_token=p_dispatch_token
     and j.status='QUEUED';
  get diagnostics v_changed=row_count;
  select j.target_model_version into v_target
    from private.model_validation_jobs j
   where j.id=p_job_id and j.dispatch_token=p_dispatch_token;
  return query select v_changed=1,v_target;
end;
$$;

revoke all on function public.claim_stage4_model_validation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_stage4_model_validation(uuid,uuid) to service_role;

create or replace function public.complete_stage4_model_validation(
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
  v_target text;
  v_changed integer:=0;
begin
  select j.target_model_version into v_target
    from private.model_validation_jobs j
   where j.id=p_job_id
     and j.dispatch_token=p_dispatch_token
     and j.status='RUNNING'
   for update;
  if v_target is null then return false; end if;

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
    update public.model_versions mv
       set out_of_sample_metrics=coalesce(p_report,'{}'::jsonb)
     where mv.id=(
       select candidate.id
       from public.model_versions candidate
       where candidate.market_family='CORNERS'
         and candidate.model_version=v_target
       order by candidate.created_at desc
       limit 1
     );
  end if;
  return true;
end;
$$;

revoke all on function public.complete_stage4_model_validation(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.complete_stage4_model_validation(uuid,uuid,jsonb,text) to service_role;

create or replace function public.kick_stage4_corners_validation()
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
  select j.id into v_job_id
  from private.model_validation_jobs j
  where j.market_family='CORNERS'
    and j.target_model_version='corners-negbin-v2+nb2'
    and j.status in ('QUEUED','RUNNING')
  order by j.created_at desc
  limit 1;
  if v_job_id is not null then
    return query select v_job_id,null::bigint;
    return;
  end if;

  insert into private.model_validation_jobs(
    market_family,target_model_version,protocol_version,status
  ) values(
    'CORNERS','corners-negbin-v2+nb2','stage4-corners-walk-forward-v1','QUEUED'
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
    'stage4-model-validation',
    v_request_id,
    pg_catalog.jsonb_build_object('jobId',v_job_id,'marketFamily','CORNERS','targetModelVersion','corners-negbin-v2+nb2')
  )
  on conflict do nothing;

  return query select v_job_id,v_request_id;
end;
$$;

revoke all on function public.kick_stage4_corners_validation() from public,anon,authenticated;
grant execute on function public.kick_stage4_corners_validation() to service_role;

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260913-stage4-corners-walk-forward',
  'stage4_corners_walk_forward',
  'Registers exact domestic corners runtime artifacts and adds a server-only point-in-time validation job. No model promotion or calibration is performed automatically.'
)
on conflict (version) do update
set migration_name=excluded.migration_name,
    notes=excluded.notes,
    applied_at=pg_catalog.now();
