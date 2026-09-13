-- Automated D+2 analysis discovery and id-first run creation.
-- Runtime truth: Lovable Cloud. Versioned truth: GitHub main.

-- One owner/configuration for the private scheduled workflow. The project is
-- currently single-user, but the owner remains explicit instead of inferred on
-- every execution.
create table if not exists private.scheduled_analysis_config(
  singleton boolean primary key default true check(singleton),
  owner_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  target_offset_days integer not null default 2 check(target_offset_days between 1 and 7),
  updated_at timestamptz not null default pg_catalog.now()
);
revoke all on private.scheduled_analysis_config from public,anon,authenticated;
grant select on private.scheduled_analysis_config to service_role;

-- Safe bootstrap only when the runtime has exactly one known application owner.
with candidate_owners as (
  select distinct owner_id
  from public.experimental_bankroll_config
  where owner_id is not null
  union
  select distinct owner_id
  from public.analysis_runs
  where owner_id is not null
), single_owner as (
  select owner_id
  from candidate_owners
  where (select count(*) from candidate_owners)=1
  limit 1
)
insert into private.scheduled_analysis_config(singleton,owner_id,enabled,target_offset_days)
select true,owner_id,true,2 from single_owner
on conflict(singleton) do nothing;

create or replace function public.get_scheduled_daily_analysis_config()
returns table(owner_id uuid,enabled boolean,target_offset_days integer)
language sql
stable
security definer
set search_path=''
as $$
  select c.owner_id,c.enabled,c.target_offset_days
  from private.scheduled_analysis_config c
  where c.singleton=true
$$;
revoke all on function public.get_scheduled_daily_analysis_config() from public,anon,authenticated;
grant execute on function public.get_scheduled_daily_analysis_config() to service_role;

create or replace function public.get_scheduled_daily_analysis_state(
  p_owner_id uuid,
  p_target_date date
)
returns table(run_id uuid,run_status text,job_status text)
language sql
stable
security definer
set search_path=''
as $$
  select r.id,r.status,j.status
  from public.analysis_runs r
  left join public.analysis_jobs j on j.run_id=r.id and j.user_id=r.owner_id
  where r.owner_id=p_owner_id
    and r.target_date=p_target_date
    and r.notes->>'origin'='SCHEDULED_D2'
  order by r.created_at desc
  limit 1
$$;
revoke all on function public.get_scheduled_daily_analysis_state(uuid,date) from public,anon,authenticated;
grant execute on function public.get_scheduled_daily_analysis_state(uuid,date) to service_role;

create or replace function public.create_scheduled_analysis_run_atomic(
  p_owner_id uuid,
  p_target_date date,
  p_fixtures jsonb
)
returns table(run_id uuid,reused boolean)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_run_id uuid;
  v_match_id uuid;
  v_count integer;
  v_idempotency_key uuid;
  v_fixture jsonb;
  v_event_id bigint;
  v_home_team_id bigint;
  v_away_team_id bigint;
  v_league_id bigint;
  v_home_name text;
  v_away_name text;
  v_competition text;
  v_kickoff timestamptz;
begin
  if p_owner_id is null or p_target_date is null then
    raise exception 'Configuração da análise automática inválida.';
  end if;
  if not exists(
    select 1 from private.scheduled_analysis_config c
    where c.singleton=true and c.enabled=true and c.owner_id=p_owner_id
  ) then
    raise exception 'Análise automática não autorizada para este usuário.';
  end if;
  if jsonb_typeof(p_fixtures)<>'array' then
    raise exception 'Lista automática de partidas inválida.';
  end if;

  v_count:=jsonb_array_length(p_fixtures);
  if v_count<1 or v_count>300 then
    raise exception 'A análise automática deve conter entre 1 e 300 partidas.';
  end if;
  if exists(
    select 1
    from pg_catalog.jsonb_array_elements(p_fixtures) f
    group by f->>'event_id'
    having count(*)>1
  ) then
    raise exception 'A fonte retornou fixture duplicada para a análise automática.';
  end if;

  -- Stable UUID derived from owner + target date. The existing owner/idempotency
  -- unique index remains the final duplicate guard under concurrent dispatches.
  v_idempotency_key := (
    pg_catalog.substr(pg_catalog.md5('scheduled-d2:'||p_owner_id::text||':'||p_target_date::text),1,8)||'-'||
    pg_catalog.substr(pg_catalog.md5('scheduled-d2:'||p_owner_id::text||':'||p_target_date::text),9,4)||'-'||
    pg_catalog.substr(pg_catalog.md5('scheduled-d2:'||p_owner_id::text||':'||p_target_date::text),13,4)||'-'||
    pg_catalog.substr(pg_catalog.md5('scheduled-d2:'||p_owner_id::text||':'||p_target_date::text),17,4)||'-'||
    pg_catalog.substr(pg_catalog.md5('scheduled-d2:'||p_owner_id::text||':'||p_target_date::text),21,12)
  )::uuid;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_id::text||':scheduled-d2:'||p_target_date::text,0)
  );

  select r.id into v_run_id
  from public.analysis_runs r
  where r.owner_id=p_owner_id
    and (
      r.idempotency_key=v_idempotency_key
      or (r.target_date=p_target_date and r.notes->>'origin'='SCHEDULED_D2')
    )
  order by r.created_at desc
  limit 1;

  if v_run_id is not null then
    return query select v_run_id,true;
    return;
  end if;

  -- Validate every provider identity before creating anything.
  for v_fixture in select value from pg_catalog.jsonb_array_elements(p_fixtures)
  loop
    v_event_id:=nullif(v_fixture->>'event_id','')::bigint;
    v_home_team_id:=nullif(v_fixture->>'home_team_id','')::bigint;
    v_away_team_id:=nullif(v_fixture->>'away_team_id','')::bigint;
    v_league_id:=nullif(v_fixture->>'league_id','')::bigint;
    v_home_name:=pg_catalog.btrim(pg_catalog.coalesce(v_fixture->>'home_name',''));
    v_away_name:=pg_catalog.btrim(pg_catalog.coalesce(v_fixture->>'away_name',''));
    v_competition:=pg_catalog.btrim(pg_catalog.coalesce(v_fixture->>'competition',''));
    v_kickoff:=nullif(v_fixture->>'kickoff_at','')::timestamptz;

    if v_event_id is null or v_event_id<=0
      or v_home_team_id is null or v_home_team_id<=0
      or v_away_team_id is null or v_away_team_id<=0
      or v_league_id is null or v_league_id<=0
      or v_home_name='' or v_away_name='' or v_competition='' or v_kickoff is null then
      raise exception 'Fixture automática sem identidade oficial completa.';
    end if;

    if not (
      exists(select 1 from public.elo_target_leagues l where l.active=true and l.league_id=v_league_id)
      or exists(select 1 from public.elo_cross_competitions c where c.active=true and c.competition_id=v_league_id)
    ) then
      raise exception 'Fixture de campeonato fora do escopo autorizado: %.',v_league_id;
    end if;
  end loop;

  insert into public.analysis_runs(
    owner_id,idempotency_key,target_date,status,matches_total,matches_resolved,matches_failed,notes
  ) values(
    p_owner_id,v_idempotency_key,p_target_date,'CREATED',v_count,v_count,0,
    pg_catalog.jsonb_build_object(
      'prediction_at',pg_catalog.now(),
      'origin','SCHEDULED_D2',
      'fixture_identity','FIVE_DOLLAR_IDS',
      'target_offset_days',2
    )
  ) returning id into v_run_id;

  insert into public.uploaded_files(run_id,filename,row_count,invalid_row_count,leagues,raw_headers)
  values(
    v_run_id,
    'automatic-'||p_target_date::text||'-five-dollar.json',
    v_count,
    0,
    coalesce((
      select pg_catalog.array_agg(distinct pg_catalog.btrim(f->>'competition'))
      from pg_catalog.jsonb_array_elements(p_fixtures) f
      where pg_catalog.btrim(pg_catalog.coalesce(f->>'competition',''))<>''
    ),'{}'::text[]),
    array['fixture_id','home_team_id','away_team_id','league_id','kickoff_at']::text[]
  );

  for v_fixture in select value from pg_catalog.jsonb_array_elements(p_fixtures)
  loop
    v_event_id:=(v_fixture->>'event_id')::bigint;
    v_home_team_id:=(v_fixture->>'home_team_id')::bigint;
    v_away_team_id:=(v_fixture->>'away_team_id')::bigint;
    v_league_id:=(v_fixture->>'league_id')::bigint;
    v_home_name:=pg_catalog.btrim(v_fixture->>'home_name');
    v_away_name:=pg_catalog.btrim(v_fixture->>'away_name');
    v_competition:=pg_catalog.btrim(v_fixture->>'competition');
    v_kickoff:=(v_fixture->>'kickoff_at')::timestamptz;

    insert into public.matches(
      run_id,raw_partida,raw_horario,raw_campeonato,
      home_team,away_team,competition,kickoff_local,timezone,
      resolver_confidence,resolution_status,resolution_reason
    ) values(
      v_run_id,
      v_home_name||' x '||v_away_name,
      pg_catalog.to_char(v_kickoff at time zone 'America/Sao_Paulo','HH24:MI'),
      v_competition,
      v_home_name,v_away_name,v_competition,v_kickoff,'America/Sao_Paulo',
      1,'RESOLVED_FIVE_DOLLAR',
      'Identificada diretamente pelo calendário 5Dollar por IDs oficiais; sem matching textual.'
    ) returning id into v_match_id;

    insert into public.match_external_ids(match_id,source,external_id,confidence)
    values
      (v_match_id,'five_dollar_fixture',v_event_id::text,1),
      (v_match_id,'five_dollar_team_home',v_home_team_id::text,1),
      (v_match_id,'five_dollar_team_away',v_away_team_id::text,1),
      (v_match_id,'five_dollar_league',v_league_id::text,1);
  end loop;

  insert into public.pipeline_logs(run_id,step,level,message,payload)
  values(
    v_run_id,'RESOLVE','INFO',
    v_count::text||' partidas identificadas diretamente por IDs oficiais da fonte; resolução textual dispensada.',
    pg_catalog.jsonb_build_object('identitySource','five_dollar','matches',v_count,'targetDate',p_target_date)
  );

  return query select v_run_id,false;
end;
$$;
revoke all on function public.create_scheduled_analysis_run_atomic(uuid,date,jsonb) from public,anon,authenticated;
grant execute on function public.create_scheduled_analysis_run_atomic(uuid,date,jsonb) to service_role;

-- Scheduled runs already have canonical provider identities, so RESOLVE is a
-- completed checkpoint from the moment the background job is created.
create or replace function public.enqueue_scheduled_analysis_job_atomic(
  p_run_id uuid,
  p_user_id uuid
)
returns table(status text,created boolean)
language plpgsql
security definer
set search_path=''
as $$
declare v_status text; v_created boolean:=false;
begin
  if not exists(
    select 1 from public.analysis_runs r
    where r.id=p_run_id and r.owner_id=p_user_id and r.notes->>'origin'='SCHEDULED_D2'
  ) then
    raise exception 'Análise automática não encontrada.';
  end if;

  insert into public.analysis_jobs(run_id,user_id,status,completed_steps)
  values(p_run_id,p_user_id,'QUEUED',array['RESOLVE']::text[])
  on conflict(run_id) do nothing;
  get diagnostics v_created=row_count;

  update public.analysis_jobs j
  set completed_steps=case
      when not ('RESOLVE'=any(j.completed_steps)) and j.status='QUEUED'
        then pg_catalog.array_append(j.completed_steps,'RESOLVE')
      else j.completed_steps
    end,
    updated_at=case when j.status='QUEUED' then pg_catalog.now() else j.updated_at end
  where j.run_id=p_run_id and j.user_id=p_user_id;

  select j.status into v_status
  from public.analysis_jobs j
  where j.run_id=p_run_id and j.user_id=p_user_id;

  return query select v_status,v_created;
end;
$$;
revoke all on function public.enqueue_scheduled_analysis_job_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_scheduled_analysis_job_atomic(uuid,uuid) to service_role;

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
  on conflict(request_id) do nothing;
  return v_request;
end;
$$;
revoke all on function public.kick_scheduled_daily_analysis() from public,anon,authenticated;
grant execute on function public.kick_scheduled_daily_analysis() to service_role;

-- pg_cron is configured in GMT. Evaluate the wall clock through the IANA zone
-- instead of hard-coding UTC-3. 12:45 is the first attempt; the short recovery
-- window is safe because run creation and job enqueue are idempotent.
do $$ begin
  if exists(select 1 from cron.job where jobname='scheduled-d2-analysis') then
    perform cron.unschedule('scheduled-d2-analysis');
  end if;
end $$;
select cron.schedule(
  'scheduled-d2-analysis',
  '*/5 * * * *',
  $cron$
    select public.kick_scheduled_daily_analysis()
    where pg_catalog.to_char(pg_catalog.now() at time zone 'America/Sao_Paulo','HH24:MI')
      in ('12:45','12:50','12:55','13:00');
  $cron$
);

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260912-scheduled-d2-analysis',
  'scheduled_d2_analysis',
  'Daily D+2 fixture discovery at 12:45 America/Sao_Paulo with id-first FiveDollar identities, idempotent recovery dispatches and background completion push.'
)
on conflict(version) do update
set migration_name=excluded.migration_name,notes=excluded.notes,applied_at=pg_catalog.now();
