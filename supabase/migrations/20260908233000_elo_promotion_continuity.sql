-- Preserve team strength when a club moves between domestic divisions.
-- A team entering a new league is seeded from its latest Elo in another target
-- league from the same country, translated through the league-strength priors.
-- This avoids treating a newly promoted club as an average top-flight team.

create or replace function public.elo_seed_rating(
  p_team_id bigint,
  p_new_league_id bigint,
  p_before timestamptz
)
returns double precision
language plpgsql
stable
security definer
set search_path='public'
as $function$
declare
  v_old_rating double precision;
  v_old_prior double precision;
  v_new_prior double precision;
begin
  select cfg.prior_rating::double precision
  into v_new_prior
  from public.elo_target_leagues cfg
  where cfg.league_id=p_new_league_id and cfg.active;

  if v_new_prior is null then return 1500; end if;

  select
    case
      when h.home_team_id=p_team_id then h.home_rating_after::double precision
      else h.away_rating_after::double precision
    end,
    old_cfg.prior_rating::double precision
  into v_old_rating,v_old_prior
  from public.elo_fixture_history h
  join public.elo_target_leagues old_cfg
    on old_cfg.league_id=h.league_id and old_cfg.active
  join public.elo_target_leagues new_cfg
    on new_cfg.league_id=p_new_league_id and new_cfg.active
  where h.model_version='elo-v1-w020'
    and h.league_id<>p_new_league_id
    and h.kickoff_at<p_before
    and old_cfg.country_code=new_cfg.country_code
    and (h.home_team_id=p_team_id or h.away_team_id=p_team_id)
  order by h.kickoff_at desc,h.fixture_id desc
  limit 1;

  if v_old_rating is null or v_old_prior is null then return 1500; end if;

  return greatest(
    1350.0,
    least(1650.0,v_old_rating+v_old_prior-v_new_prior)
  );
end
$function$;

create or replace function public.elo_rebuild_league(p_league_id bigint)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  f record;
  h_rating double precision;
  a_rating double precision;
  h_after double precision;
  a_after double precision;
  ha double precision;
  expected_h double precision;
  actual_h double precision;
  delta double precision;
  prior_home_sum double precision:=0;
  prior_matches integer:=0;
  p double precision;
  v_key text;
  v_name text;
  v_teams integer;
  v_seeded integer:=0;
begin
  select league_key,league_name into v_key,v_name
  from public.elo_fixtures
  where source='five_dollar_football' and league_id=p_league_id
  order by kickoff_at desc limit 1;

  if v_key is null then
    return jsonb_build_object('fixtures',0,'teams',0,'seededTransitions',0);
  end if;

  delete from public.elo_fixture_history
  where model_version='elo-v1-w020' and league_id=p_league_id;
  delete from public.elo_team_ratings
  where model_version='elo-v1-w020' and league_id=p_league_id;

  for f in
    select * from public.elo_fixtures
    where source='five_dollar_football' and league_id=p_league_id
    order by kickoff_at,fixture_id
  loop
    select rating::double precision into h_rating
    from public.elo_team_ratings
    where model_version='elo-v1-w020'
      and league_id=p_league_id
      and team_id=f.home_team_id;

    if h_rating is null then
      h_rating:=public.elo_seed_rating(f.home_team_id,p_league_id,f.kickoff_at);
      if abs(h_rating-1500)>0.000001 then v_seeded:=v_seeded+1; end if;
    end if;

    select rating::double precision into a_rating
    from public.elo_team_ratings
    where model_version='elo-v1-w020'
      and league_id=p_league_id
      and team_id=f.away_team_id;

    if a_rating is null then
      a_rating:=public.elo_seed_rating(f.away_team_id,p_league_id,f.kickoff_at);
      if abs(a_rating-1500)>0.000001 then v_seeded:=v_seeded+1; end if;
    end if;

    if prior_matches<30 then
      ha:=60;
    else
      p:=greatest(0.5,least(0.665,prior_home_sum/prior_matches));
      ha:=greatest(0,least(120,400*(ln(p/(1-p))/ln(10.0))));
    end if;

    expected_h:=1.0/(1.0+power(10.0,(a_rating-h_rating-ha)/400.0));
    actual_h:=case
      when f.home_goals>f.away_goals then 1.0
      when f.home_goals=f.away_goals then 0.5
      else 0.0
    end;
    delta:=20.0*(actual_h-expected_h);
    h_after:=h_rating+delta;
    a_after:=a_rating-delta;

    insert into public.elo_fixture_history(
      model_version,league_id,league_key,league_name,fixture_id,kickoff_at,
      home_team_id,home_team_name,away_team_id,away_team_name,home_goals,away_goals,
      home_rating_before,away_rating_before,home_rating_after,away_rating_after,
      home_advantage_points,expected_home_score,actual_home_score,elo_delta
    ) values(
      'elo-v1-w020',f.league_id,f.league_key,f.league_name,f.fixture_id,f.kickoff_at,
      f.home_team_id,f.home_team_name,f.away_team_id,f.away_team_name,f.home_goals,f.away_goals,
      h_rating,a_rating,h_after,a_after,ha,expected_h,actual_h,delta
    );

    insert into public.elo_team_ratings(
      model_version,league_id,league_key,league_name,team_id,team_name,rating,
      matches_processed,first_fixture_at,last_fixture_at,updated_at
    ) values(
      'elo-v1-w020',f.league_id,f.league_key,f.league_name,
      f.home_team_id,f.home_team_name,h_after,1,f.kickoff_at,f.kickoff_at,now()
    )
    on conflict(model_version,league_id,team_id) do update set
      league_key=excluded.league_key,
      league_name=excluded.league_name,
      team_name=excluded.team_name,
      rating=excluded.rating,
      matches_processed=public.elo_team_ratings.matches_processed+1,
      last_fixture_at=excluded.last_fixture_at,
      updated_at=now();

    insert into public.elo_team_ratings(
      model_version,league_id,league_key,league_name,team_id,team_name,rating,
      matches_processed,first_fixture_at,last_fixture_at,updated_at
    ) values(
      'elo-v1-w020',f.league_id,f.league_key,f.league_name,
      f.away_team_id,f.away_team_name,a_after,1,f.kickoff_at,f.kickoff_at,now()
    )
    on conflict(model_version,league_id,team_id) do update set
      league_key=excluded.league_key,
      league_name=excluded.league_name,
      team_name=excluded.team_name,
      rating=excluded.rating,
      matches_processed=public.elo_team_ratings.matches_processed+1,
      last_fixture_at=excluded.last_fixture_at,
      updated_at=now();

    prior_home_sum:=prior_home_sum+actual_h;
    prior_matches:=prior_matches+1;
  end loop;

  select count(*) into v_teams
  from public.elo_team_ratings
  where model_version='elo-v1-w020' and league_id=p_league_id;

  return jsonb_build_object(
    'fixtures',prior_matches,
    'teams',v_teams,
    'leagueKey',v_key,
    'leagueName',v_name,
    'seededTransitions',v_seeded
  );
end
$function$;

-- Strengthen the persisted audit with an explicit cross-tier invariant:
-- no second division may outrank the weakest Big-5 first division.
create or replace function public.elo_run_audit()
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  s jsonb;
  i jsonb;
  st text;
  rid uuid;
  v_min_big5 numeric;
  v_max_div2 numeric;
begin
  select min(rating) into v_min_big5
  from public.elo_league_ratings
  where model_version='league-elo-v1'
    and league_key in (
      'england-premier-league','spain-la-liga','germany-bundesliga',
      'italy-serie-a','france-ligue-1'
    );

  select max(rating) into v_max_div2
  from public.elo_league_ratings
  where model_version='league-elo-v1' and division_level>=2;

  select jsonb_build_object(
    'targetLeagues',count(*),
    'leaguesWithTeamElo',count(*) filter(where teams>0),
    'teams',coalesce(sum(teams),0),
    'leagueRatings',count(*) filter(where league_rating is not null),
    'hierarchyViolations',count(*) filter(where hierarchy_ok=false),
    'minBig5LeagueRating',v_min_big5,
    'maxSecondDivisionRating',v_max_div2,
    'secondDivisionsBelowBig5',coalesce(v_max_div2<v_min_big5,true),
    'syncErrors',count(*) filter(where last_sync_status='ERROR'),
    'auditIssues',count(*) filter(where audit_status<>'OK'),
    'crossTargets',(select count(*) from public.elo_cross_competitions where active),
    'crossSyncErrors',(select count(*) from public.elo_cross_competitions where active and last_sync_status='ERROR'),
    'crossFixturesStored',(select count(*) from public.elo_cross_fixtures),
    'crossFixturesUsed',(select count(*) from public.elo_league_fixture_history where model_version='league-elo-v1'),
    'latestTeamFixture',max(last_fixture_at)
  ) into s
  from public.elo_audit_leagues;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'leagueKey',league_key,
      'leagueName',league_name,
      'status',audit_status,
      'syncStatus',last_sync_status,
      'syncError',last_sync_error,
      'teams',teams,
      'localAvg',local_avg_rating,
      'localMin',local_min_rating,
      'localMax',local_max_rating,
      'leagueRating',league_rating,
      'parent',parent_league_key,
      'parentRating',parent_league_rating,
      'hierarchyOk',hierarchy_ok
    )) filter(where audit_status<>'OK'),
    '[]'::jsonb
  ) into i
  from public.elo_audit_leagues;

  st:=case
    when jsonb_array_length(i)=0
      and (select count(*) from public.elo_cross_competitions where active and last_sync_status='ERROR')=0
      and coalesce(v_max_div2<v_min_big5,true)
    then 'OK'
    else 'ATTENTION'
  end;

  insert into public.elo_audit_runs(model_version,status,summary,issues)
  values('hierarchical-elo-v1',st,s,i)
  returning id into rid;

  return jsonb_build_object('id',rid,'status',st,'summary',s,'issues',i);
end
$function$;
