-- Stage 3 — real production replay fix.
--
-- The scheduled run creator was deployed with `pg_catalog.coalesce(...)` while
-- running with an empty search_path. COALESCE is SQL syntax, not a function in
-- pg_catalog, so the first real D+2 replay failed with SQLSTATE 42883 before the
-- run could be inserted. Keep the function contract and all identity/competition
-- guards intact; only use the valid COALESCE expression.

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

  for v_fixture in select value from pg_catalog.jsonb_array_elements(p_fixtures)
  loop
    v_event_id:=nullif(v_fixture->>'event_id','')::bigint;
    v_home_team_id:=nullif(v_fixture->>'home_team_id','')::bigint;
    v_away_team_id:=nullif(v_fixture->>'away_team_id','')::bigint;
    v_league_id:=nullif(v_fixture->>'league_id','')::bigint;
    v_home_name:=pg_catalog.btrim(coalesce(v_fixture->>'home_name',''));
    v_away_name:=pg_catalog.btrim(coalesce(v_fixture->>'away_name',''));
    v_competition:=pg_catalog.btrim(coalesce(v_fixture->>'competition',''));
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
      where pg_catalog.btrim(coalesce(f->>'competition',''))<>''
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

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260913-stage3-d2-create-run-coalesce-fix',
  'stage3_d2_create_run_coalesce_fix',
  'Fixes SQLSTATE 42883 in the scheduled D+2 run creator by using the SQL COALESCE expression instead of the nonexistent pg_catalog.coalesce function; all identity, competition, idempotency and permission guards remain unchanged.'
)
on conflict(version) do update
set migration_name=excluded.migration_name,
    notes=excluded.notes,
    applied_at=pg_catalog.now();
