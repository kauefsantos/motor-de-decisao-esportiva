-- 5Dollar Pro: ampliar cobertura doméstica do Elo e respeitar 10 req/min.
-- O Elo permanece restrito a ligas domésticas; copas/continentais não ganham rating próprio.

create or replace function public.elo_is_target_league(p_country text, p_name text)
returns boolean language plpgsql immutable as $$
declare n text := lower(coalesce(p_name,''));
begin
  if n ~ '(women|femin|youth|junior|u[0-9]|reserve)' then return false; end if;
  if p_country='GB-ENG' then return n like '%premier league%' or n like '%championship%'; end if;
  if p_country='DE' then return n like '%bundesliga%' and n not like '%3. liga%'; end if;
  if p_country='ES' then return n like '%la liga%' or n like '%segunda division%'; end if;
  if p_country='IT' then return n like '%serie a%' or n like '%serie b%'; end if;
  if p_country='FR' then return n like '%ligue 1%' or n like '%ligue 2%'; end if;
  if p_country='BR' then return n like '%serie a%' or n like '%serie b%'; end if;
  if p_country='PT' then return n like '%primeira liga%' or n like '%liga portugal%'; end if;
  if p_country='NL' then return n like '%eredivisie%'; end if;
  if p_country='BE' then return n like '%pro league%'; end if;
  if p_country='TR' then return n like '%super lig%' or n like '%süper lig%'; end if;
  if p_country='AR' then return n like '%liga profesional%' or n like '%primera division%'; end if;
  if p_country='US' then return n like '%major league soccer%' or n='mls'; end if;
  if p_country='SA' then return n like '%pro league%'; end if;
  return false;
end $$;

create or replace function public.elo_league_key(p_country text, p_name text)
returns text language sql immutable as $$
  select case
    when p_country='GB-ENG' and lower(p_name) like '%championship%' then 'england-championship'
    when p_country='GB-ENG' then 'england-premier-league'
    when p_country='DE' and (lower(p_name) like '%2.%' or lower(p_name) like '%2 bundesliga%') then 'germany-2-bundesliga'
    when p_country='DE' then 'germany-bundesliga'
    when p_country='ES' and (lower(p_name) like '%la liga 2%' or lower(p_name) like '%segunda%') then 'spain-la-liga-2'
    when p_country='ES' then 'spain-la-liga'
    when p_country='IT' and lower(p_name) like '%serie b%' then 'italy-serie-b'
    when p_country='IT' then 'italy-serie-a'
    when p_country='FR' and lower(p_name) like '%ligue 2%' then 'france-ligue-2'
    when p_country='FR' then 'france-ligue-1'
    when p_country='BR' and lower(p_name) like '%serie b%' then 'brazil-serie-b'
    when p_country='BR' then 'brazil-serie-a'
    when p_country='PT' then 'portugal-primeira-liga'
    when p_country='NL' then 'netherlands-eredivisie'
    when p_country='BE' then 'belgium-pro-league'
    when p_country='TR' then 'turkey-super-lig'
    when p_country='AR' then 'argentina-primera'
    when p_country='US' then 'usa-mls'
    when p_country='SA' then 'saudi-pro-league'
    else lower(regexp_replace(trim(p_name),'[^a-zA-Z0-9]+','-','g'))
  end
$$;

create or replace function public.elo_sync_from_5dollar()
returns jsonb language plpgsql security definer set search_path to 'public','extensions','vault' as $$
declare
  v_key text; v_started timestamptz := clock_timestamp(); v_country text; v_country_page integer; v_fixture_page integer;
  v_resp extensions.http_response; v_payload jsonb; v_item jsonb; v_fixture jsonb; v_has_more boolean;
  v_league_id bigint; v_league_name text; v_league_key text; v_latest timestamptz; v_start_ts bigint;
  v_end_ts bigint := floor(extract(epoch from now()))::bigint; v_bootstrap_ts bigint := floor(extract(epoch from now()-interval '365 days'))::bigint;
  v_home_id bigint; v_away_id bigint; v_fixture_id bigint; v_kickoff timestamptz; v_home_goals integer; v_away_goals integer;
  v_home_name text; v_away_name text; v_requests integer := 0; v_fetched integer := 0; v_leagues integer := 0;
  v_details jsonb := '[]'::jsonb; v_rebuild jsonb; v_url text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name='elo_five_dollar_api_key' order by created_at desc limit 1;
  insert into public.elo_sync_state(id,source,model_version,last_started_at,last_status,error_message,updated_at)
  values('main','five_dollar_football','elo-v1-w020',v_started,'RUNNING',null,now())
  on conflict(id) do update set last_started_at=excluded.last_started_at,last_status='RUNNING',error_message=null,updated_at=now();
  if v_key is null or length(v_key)<8 then
    update public.elo_sync_state set last_completed_at=clock_timestamp(),last_status='WAITING_FOR_KEY',error_message='5Dollar secret ainda não foi semeado pelo backend.',updated_at=now() where id='main';
    return jsonb_build_object('status','WAITING_FOR_KEY');
  end if;

  foreach v_country in array array['GB-ENG','DE','ES','IT','FR','BR','PT','NL','BE','TR','AR','US','SA'] loop
    v_country_page := 1;
    loop
      perform pg_sleep(6.2);
      v_url := 'https://api.5dollarfootballapi.com/v1/leagues?country='||v_country||'&active_since='||v_bootstrap_ts||'&page='||v_country_page||'&per_page=100';
      select * into v_resp from extensions.http((row('GET'::extensions.http_method,v_url,array[row('Accept','application/json')::extensions.http_header,row('Authorization','Bearer '||v_key)::extensions.http_header],null,null)::extensions.http_request));
      v_requests := v_requests+1;
      if v_resp.status=429 then raise exception '5Dollar rate limit during league discovery'; end if;
      if v_resp.status<200 or v_resp.status>=300 then raise exception '5Dollar leagues % returned HTTP %: %',v_country,v_resp.status,left(v_resp.content,300); end if;
      v_payload := v_resp.content::jsonb;
      for v_item in select value from jsonb_array_elements(coalesce(v_payload->'data','[]'::jsonb)) loop
        v_league_id := nullif(v_item->>'id','')::bigint; v_league_name := v_item->>'name';
        if v_league_id is null or v_league_name is null or not public.elo_is_target_league(v_country,v_league_name) then continue; end if;
        v_league_key := public.elo_league_key(v_country,v_league_name);
        select max(kickoff_at) into v_latest from public.elo_fixtures where source='five_dollar_football' and league_id=v_league_id;
        if v_latest is null then v_start_ts := v_bootstrap_ts; else v_start_ts := greatest(v_bootstrap_ts,floor(extract(epoch from v_latest-interval '3 days'))::bigint); end if;
        v_fixture_page := 1;
        loop
          perform pg_sleep(6.2);
          v_url := 'https://api.5dollarfootballapi.com/v1/leagues/'||v_league_id||'/fixtures?status=finished&start_time='||v_start_ts||'&end_time='||v_end_ts||'&page='||v_fixture_page||'&per_page=100';
          select * into v_resp from extensions.http((row('GET'::extensions.http_method,v_url,array[row('Accept','application/json')::extensions.http_header,row('Authorization','Bearer '||v_key)::extensions.http_header],null,null)::extensions.http_request));
          v_requests := v_requests+1;
          if v_resp.status=429 then raise exception '5Dollar rate limit while fetching league %',v_league_id; end if;
          if v_resp.status<200 or v_resp.status>=300 then raise exception '5Dollar league % fixtures returned HTTP %: %',v_league_id,v_resp.status,left(v_resp.content,300); end if;
          v_payload := v_resp.content::jsonb;
          for v_fixture in select value from jsonb_array_elements(coalesce(v_payload->'data','[]'::jsonb)) loop
            if lower(coalesce(v_fixture->>'status',''))<>'finished' then continue; end if;
            v_fixture_id := nullif(v_fixture->>'id','')::bigint; v_home_id := nullif(v_fixture#>>'{teams,home,id}','')::bigint; v_away_id := nullif(v_fixture#>>'{teams,away,id}','')::bigint;
            v_home_name := v_fixture#>>'{teams,home,name}'; v_away_name := v_fixture#>>'{teams,away,name}'; v_home_goals := nullif(v_fixture#>>'{goals,home}','')::integer; v_away_goals := nullif(v_fixture#>>'{goals,away}','')::integer;
            if nullif(v_fixture->>'kickoff_ts','') is not null then v_kickoff := to_timestamp((v_fixture->>'kickoff_ts')::double precision);
            elsif nullif(v_fixture->>'kickoff_utc','') is not null then v_kickoff := (v_fixture->>'kickoff_utc')::timestamptz; else v_kickoff := null; end if;
            if v_fixture_id is null or v_home_id is null or v_away_id is null or v_home_name is null or v_away_name is null or v_home_goals is null or v_away_goals is null or v_kickoff is null then continue; end if;
            insert into public.elo_fixtures(source,league_id,league_key,league_name,country_code,fixture_id,kickoff_at,home_team_id,home_team_name,away_team_id,away_team_name,home_goals,away_goals,fetched_at,updated_at)
            values('five_dollar_football',v_league_id,v_league_key,v_league_name,v_country,v_fixture_id,v_kickoff,v_home_id,v_home_name,v_away_id,v_away_name,v_home_goals,v_away_goals,now(),now())
            on conflict(source,league_id,fixture_id) do update set league_key=excluded.league_key,league_name=excluded.league_name,country_code=excluded.country_code,kickoff_at=excluded.kickoff_at,home_team_id=excluded.home_team_id,home_team_name=excluded.home_team_name,away_team_id=excluded.away_team_id,away_team_name=excluded.away_team_name,home_goals=excluded.home_goals,away_goals=excluded.away_goals,fetched_at=excluded.fetched_at,updated_at=now();
            v_fetched := v_fetched+1;
          end loop;
          v_has_more := coalesce((v_payload#>>'{pagination,has_more}')::boolean,false); exit when not v_has_more; v_fixture_page := v_fixture_page+1;
        end loop;
        v_rebuild := public.elo_rebuild_league(v_league_id); v_leagues := v_leagues+1;
        v_details := v_details || jsonb_build_array(jsonb_build_object('country',v_country,'leagueId',v_league_id,'leagueName',v_league_name,'leagueKey',v_league_key,'rebuild',v_rebuild));
      end loop;
      v_has_more := coalesce((v_payload#>>'{pagination,has_more}')::boolean,false); exit when not v_has_more; v_country_page := v_country_page+1;
    end loop;
  end loop;
  update public.elo_sync_state set last_completed_at=clock_timestamp(),last_status='OK',leagues_processed=v_leagues,fixtures_fetched=v_fetched,api_requests=v_requests,error_message=null,details=jsonb_build_object('leagues',v_details),updated_at=now() where id='main';
  return jsonb_build_object('status','OK','leagues',v_leagues,'fixturesFetched',v_fetched,'apiRequests',v_requests,'details',v_details);
exception when others then
  update public.elo_sync_state set last_completed_at=clock_timestamp(),last_status='ERROR',leagues_processed=v_leagues,fixtures_fetched=v_fetched,api_requests=v_requests,error_message=sqlerrm,details=jsonb_build_object('leagues',v_details),updated_at=now() where id='main';
  return jsonb_build_object('status','ERROR','error',sqlerrm,'leagues',v_leagues,'fixturesFetched',v_fetched,'apiRequests',v_requests);
end $$;
