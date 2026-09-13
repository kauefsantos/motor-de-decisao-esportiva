-- Stage 6: immutable model-artifact inventory plus generic, server-only validation jobs.
-- This migration does not promote any model and does not create a calibration artifact.

alter table private.model_validation_jobs
  add column if not exists target_calibration_version text;

with artifacts(market_family,model_version,note) as (
  values
    ('1X2','goals-baseline-v1','Historical runtime artifact observed in model_predictions; retained as immutable history.'),
    ('1X2','goals-baseline-v1+elo-v1-w020','Historical runtime artifact observed in model_predictions; retained as immutable history.'),
    ('1X2','goals-baseline-v2-recency','Current domestic GOALS baseline; Stage 6 validation target.'),
    ('1X2','goals-baseline-v2-recency+elo-v1-w020','Current domestic GOALS + point-in-time Elo artifact; Stage 6 validation target.'),
    ('1X2','goals-baseline-v2-recency+cross-league-domestic-v1','Cross-league runtime artifact; inventoried separately and excluded from the domestic replay.'),
    ('1X2','goals-baseline-v2-recency+cross-league-domestic-v1+elo-v2-hierarchical','Hierarchical cross-league runtime artifact; inventoried separately and excluded from the domestic replay.'),
    ('BTTS','goals-baseline-v1','Historical runtime artifact observed in model_predictions; retained as immutable history.'),
    ('BTTS','goals-baseline-v1+elo-v1-w020','Historical runtime artifact observed in model_predictions; retained as immutable history.'),
    ('BTTS','goals-baseline-v2-recency','Current domestic GOALS baseline; Stage 6 validation target.'),
    ('BTTS','goals-baseline-v2-recency+elo-v1-w020','Current domestic GOALS + point-in-time Elo artifact; Stage 6 validation target.'),
    ('BTTS','goals-baseline-v2-recency+cross-league-domestic-v1','Cross-league runtime artifact; inventoried separately and excluded from the domestic replay.')
)
insert into public.model_versions(
  market_family,model_version,calibration_version,validation_status,out_of_sample_metrics
)
select
  a.market_family,
  a.model_version,
  null,
  'NOT_PRODUCTION_VALIDATED',
  pg_catalog.jsonb_build_object(
    'stage6InventoryStatus','REGISTERED_RUNTIME_ARTIFACT',
    'observedRuntimeArtifact',true,
    'note',a.note
  )
from artifacts a
where not exists (
  select 1
  from public.model_versions mv
  where mv.market_family=a.market_family
    and mv.model_version=a.model_version
    and mv.calibration_version is null
);

create or replace function public.get_model_artifact_inventory()
returns table(
  market text,
  inferred_family text,
  model_version text,
  calibration_version text,
  model_status text,
  data_status text,
  prediction_count bigint,
  first_prediction_at timestamptz,
  last_prediction_at timestamptz,
  registry_found boolean,
  registry_validation_status text,
  registry_calibration_version text
)
language sql
stable
security definer
set search_path=''
as $$
  with observed as (
    select
      mp.market,
      case
        when mp.market='1x2' then '1X2'
        when mp.market='btts' then 'BTTS'
        when mp.market like 'corners_%' then 'CORNERS'
        when mp.market like 'cards_%' then 'CARDS'
        when mp.market like 'shots_on_target_%' then 'SHOTS_ON_TARGET'
        when mp.market like 'shots_%' then 'SHOTS'
        when mp.market='goals_match_total' then 'GOALS_TOTAL'
        when mp.market='team_goals_total' then 'TEAM_GOALS_TOTAL'
        else pg_catalog.upper(mp.market)
      end as inferred_family,
      mp.model_version,
      mp.calibration_version,
      mp.model_status,
      mp.data_status,
      pg_catalog.count(*) as prediction_count,
      pg_catalog.min(mp.prediction_at) as first_prediction_at,
      pg_catalog.max(mp.prediction_at) as last_prediction_at
    from public.model_predictions mp
    group by mp.market,mp.model_version,mp.calibration_version,mp.model_status,mp.data_status
  )
  select
    o.market,o.inferred_family,o.model_version,o.calibration_version,o.model_status,o.data_status,
    o.prediction_count,o.first_prediction_at,o.last_prediction_at,
    mv.id is not null,
    mv.validation_status,
    mv.calibration_version
  from observed o
  left join lateral (
    select candidate.id,candidate.validation_status,candidate.calibration_version
    from public.model_versions candidate
    where candidate.market_family=o.inferred_family
      and candidate.model_version=o.model_version
      and candidate.calibration_version is not distinct from o.calibration_version
    order by candidate.created_at desc
    limit 1
  ) mv on true
  order by o.market,o.model_version,o.calibration_version nulls first,o.model_status,o.data_status;
$$;

revoke all on function public.get_model_artifact_inventory() from public,anon,authenticated;
grant execute on function public.get_model_artifact_inventory() to service_role;

create or replace function public.get_stage6_goals_validation_rows_page(
  p_after_date date default null,
  p_after_fixture_id bigint default null,
  p_limit integer default 750
)
returns table(
  fixture_id bigint,
  fixture_date date,
  league text,
  home_team_id bigint,
  away_team_id bigint,
  home_goals numeric,
  away_goals numeric,
  elo_home_rating_before numeric,
  elo_away_rating_before numeric,
  elo_model_version text
)
language sql
stable
security definer
set search_path=''
as $$
  select
    m.fixture_id,
    m.fixture_date,
    pg_catalog.split_part(m.external_match_id,':',1) as league,
    m.home_team_id,
    m.away_team_id,
    m.home_goals,
    m.away_goals,
    elo.home_rating_before,
    elo.away_rating_before,
    elo.model_version
  from private.five_dollar_model_matches m
  left join lateral (
    select e.home_rating_before,e.away_rating_before,e.model_version
    from public.elo_fixture_history e
    where e.fixture_id=m.fixture_id
      and e.home_team_id=m.home_team_id
      and e.away_team_id=m.away_team_id
      and e.model_version='elo-v1-w020'
    order by e.kickoff_at desc
    limit 1
  ) elo on true
  where m.has_conflict=false
    and m.fixture_date is not null
    and m.fixture_date < (pg_catalog.now() at time zone 'America/Sao_Paulo')::date
    and m.external_match_id is not null
    and m.home_team_id is not null
    and m.away_team_id is not null
    and m.home_goals is not null
    and m.away_goals is not null
    and (
      p_after_date is null
      or m.fixture_date > p_after_date
      or (m.fixture_date=p_after_date and m.fixture_id>pg_catalog.coalesce(p_after_fixture_id,-1))
    )
  order by m.fixture_date,m.fixture_id
  limit pg_catalog.greatest(1,pg_catalog.least(pg_catalog.coalesce(p_limit,750),750));
$$;

revoke all on function public.get_stage6_goals_validation_rows_page(date,bigint,integer) from public,anon,authenticated;
grant execute on function public.get_stage6_goals_validation_rows_page(date,bigint,integer) to service_role;

create or replace function public.claim_model_validation(
  p_job_id uuid,
  p_dispatch_token uuid
)
returns table(
  accepted boolean,
  market_family text,
  target_model_version text,
  target_calibration_version text,
  protocol_version text
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_changed integer:=0;
begin
  update private.model_validation_jobs j
     set status='RUNNING',started_at=pg_catalog.now(),updated_at=pg_catalog.now(),last_error=null
   where j.id=p_job_id
     and j.dispatch_token=p_dispatch_token
     and j.status='QUEUED';
  get diagnostics v_changed=row_count;

  return query
  select
    v_changed=1,
    j.market_family,
    j.target_model_version,
    j.target_calibration_version,
    j.protocol_version
  from private.model_validation_jobs j
  where j.id=p_job_id and j.dispatch_token=p_dispatch_token;
end;
$$;

revoke all on function public.claim_model_validation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_model_validation(uuid,uuid) to service_role;

create or replace function public.complete_model_validation(
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
  v_calibration text;
  v_registry_id uuid;
  v_changed integer:=0;
begin
  select j.market_family,j.target_model_version,j.target_calibration_version
    into v_family,v_model,v_calibration
  from private.model_validation_jobs j
  where j.id=p_job_id
    and j.dispatch_token=p_dispatch_token
    and j.status='RUNNING'
  for update;
  if v_model is null then return false; end if;

  if p_error is null then
    select mv.id into v_registry_id
    from public.model_versions mv
    where mv.market_family=v_family
      and mv.model_version=v_model
      and mv.calibration_version is not distinct from v_calibration
    order by mv.created_at desc
    limit 1;
    if v_registry_id is null then
      raise exception 'Exact model artifact is not registered.';
    end if;
  end if;

  update private.model_validation_jobs j
     set status=case when p_error is null then 'DONE' else 'ERROR' end,
         report=case when p_error is null then pg_catalog.coalesce(p_report,'{}'::jsonb) else j.report end,
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
       set out_of_sample_metrics=pg_catalog.coalesce(p_report,'{}'::jsonb)
     where mv.id=v_registry_id;
  end if;
  return true;
end;
$$;

revoke all on function public.complete_model_validation(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.complete_model_validation(uuid,uuid,jsonb,text) to service_role;

create or replace function public.kick_stage6_goals_validation(
  p_market_family text,
  p_model_version text
)
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
  if p_market_family not in ('1X2','BTTS') then
    raise exception 'Unsupported Stage 6 GOALS family.';
  end if;
  if p_model_version not in ('goals-baseline-v2-recency','goals-baseline-v2-recency+elo-v1-w020') then
    raise exception 'Unsupported Stage 6 GOALS artifact.';
  end if;
  if not exists(
    select 1 from public.model_versions mv
    where mv.market_family=p_market_family
      and mv.model_version=p_model_version
      and mv.calibration_version is null
  ) then
    raise exception 'Exact Stage 6 GOALS artifact is not registered.';
  end if;

  select j.id into v_job_id
  from private.model_validation_jobs j
  where j.market_family=p_market_family
    and j.target_model_version=p_model_version
    and j.target_calibration_version is null
    and j.protocol_version='stage6-goals-walk-forward-v1'
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
    p_market_family,p_model_version,null,'stage6-goals-walk-forward-v1','QUEUED'
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
    'stage6-goals-validation',
    v_request_id,
    pg_catalog.jsonb_build_object(
      'jobId',v_job_id,
      'marketFamily',p_market_family,
      'targetModelVersion',p_model_version,
      'protocolVersion','stage6-goals-walk-forward-v1'
    )
  )
  on conflict do nothing;

  return query select v_job_id,v_request_id;
end;
$$;

revoke all on function public.kick_stage6_goals_validation(text,text) from public,anon,authenticated;
grant execute on function public.kick_stage6_goals_validation(text,text) to service_role;

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260913-stage6-model-portfolio-validation',
  'stage6_model_portfolio_validation',
  'Inventories exact GOALS runtime artifacts and adds generic server-only point-in-time validation jobs. No model promotion, calibration creation, threshold relaxation, or production stake authorization is performed.'
)
on conflict(version) do update
set migration_name=excluded.migration_name,notes=excluded.notes,applied_at=pg_catalog.now();
