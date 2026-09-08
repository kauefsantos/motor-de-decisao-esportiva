-- With promotion/relegation continuity, domestic league Elo ledgers are no longer
-- mathematically forced to average exactly 1500: translated seeds carry strength
-- across tiers. Audit a meaningful drift (>25), not harmless sub-1-point noise.

drop view if exists public.elo_audit_leagues;
create view public.elo_audit_leagues as
select
  cfg.league_id,cfg.league_key,cfg.league_name,cfg.country_code,cfg.region,
  cfg.division_level,cfg.focus_role,cfg.prior_rating,cfg.parent_league_key,
  cfg.last_synced_at,cfg.last_sync_status,cfg.last_sync_error,
  count(t.team_id)::integer teams,
  avg(t.rating) local_avg_rating,
  abs(coalesce(avg(t.rating),1500)-1500) local_mean_drift,
  min(t.rating) local_min_rating,
  max(t.rating) local_max_rating,
  max(t.last_fixture_at) last_fixture_at,
  lr.rating league_rating,
  lr.evidence_adjustment,
  lr.evidence_matches,
  lr.hierarchy_constrained,
  parent.rating parent_league_rating,
  case when cfg.parent_league_key is null then true else lr.rating<=parent.rating-70 end hierarchy_ok,
  case
    when cfg.last_sync_status='ERROR' then 'SYNC_ERROR'
    when count(t.team_id)=0 then 'NO_TEAM_ELO'
    when abs(coalesce(avg(t.rating),1500)-1500)>25 then 'LOCAL_MEAN_DRIFT'
    when min(t.rating)<1200 or max(t.rating)>1850 then 'TEAM_RANGE_OUTLIER'
    when cfg.parent_league_key is not null and not(lr.rating<=parent.rating-70) then 'HIERARCHY_VIOLATION'
    else 'OK'
  end audit_status
from public.elo_target_leagues cfg
left join public.elo_team_ratings t
  on t.model_version='elo-v1-w020' and t.league_id=cfg.league_id
left join public.elo_league_ratings lr
  on lr.model_version='league-elo-v1' and lr.league_id=cfg.league_id
left join public.elo_league_ratings parent
  on parent.model_version='league-elo-v1' and parent.league_key=cfg.parent_league_key
where cfg.active
group by
  cfg.league_id,cfg.league_key,cfg.league_name,cfg.country_code,cfg.region,
  cfg.division_level,cfg.focus_role,cfg.prior_rating,cfg.parent_league_key,
  cfg.last_synced_at,cfg.last_sync_status,cfg.last_sync_error,
  lr.rating,lr.evidence_adjustment,lr.evidence_matches,lr.hierarchy_constrained,parent.rating;

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
  v_max_mean_drift numeric;
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

  select max(local_mean_drift) into v_max_mean_drift
  from public.elo_audit_leagues;

  select jsonb_build_object(
    'targetLeagues',count(*),
    'leaguesWithTeamElo',count(*) filter(where teams>0),
    'teams',coalesce(sum(teams),0),
    'leagueRatings',count(*) filter(where league_rating is not null),
    'hierarchyViolations',count(*) filter(where hierarchy_ok=false),
    'minBig5LeagueRating',v_min_big5,
    'maxSecondDivisionRating',v_max_div2,
    'secondDivisionsBelowBig5',coalesce(v_max_div2<v_min_big5,true),
    'maxLocalMeanDrift',v_max_mean_drift,
    'localMeanDriftTolerance',25,
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
      'localMeanDrift',local_mean_drift,
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
