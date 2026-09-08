-- Hierarchical Elo v1
-- Keeps domestic team Elo on a league-local 1500 scale and adds a league-strength
-- layer for safe cross-league comparisons. Daily sync is incremental to stay under
-- the 5Dollar Pro 10 req/min limit and Supabase statement timeout.

create table if not exists public.elo_target_leagues (
  league_id bigint primary key,
  league_key text not null unique,
  league_name text not null,
  country_code text not null,
  region text not null,
  division_level integer not null default 1,
  focus_role text not null check (focus_role in ('CORE','SUPPORT')),
  prior_rating numeric not null,
  parent_league_key text,
  active boolean not null default true,
  last_synced_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.elo_target_leagues
(league_id,league_key,league_name,country_code,region,division_level,focus_role,prior_rating,parent_league_key) values
(4160026622,'england-premier-league','England Premier League','GB-ENG','EUROPE',1,'CORE',1630,null),
(1161691669,'england-championship','England Championship','GB-ENG','EUROPE',2,'CORE',1505,'england-premier-league'),
(686337048,'germany-bundesliga','Germany Bundesliga I','DE','EUROPE',1,'CORE',1600,null),
(2408766419,'germany-2-bundesliga','Germany Bundesliga II','DE','EUROPE',2,'CORE',1475,'germany-bundesliga'),
(4212821298,'spain-la-liga','Spain La Liga','ES','EUROPE',1,'CORE',1610,null),
(3685896960,'spain-la-liga-2','Spain Segunda','ES','EUROPE',2,'CORE',1480,'spain-la-liga'),
(3405541143,'italy-serie-a','Italy Serie A','IT','EUROPE',1,'CORE',1590,null),
(2098117182,'italy-serie-b','Italy Serie B','IT','EUROPE',2,'CORE',1465,'italy-serie-a'),
(3614399544,'france-ligue-1','France Ligue 1','FR','EUROPE',1,'CORE',1560,null),
(3019278554,'france-ligue-2','France Ligue 2','FR','EUROPE',2,'CORE',1450,'france-ligue-1'),
(3118717965,'brazil-serie-a','Brazil Serie A','BR','SOUTH_AMERICA',1,'CORE',1545,null),
(522514093,'brazil-serie-b','Brazil Serie B','BR','SOUTH_AMERICA',2,'CORE',1435,'brazil-serie-a'),
(2294067630,'argentina-liga-profesional','Argentina Liga Profesional','AR','SOUTH_AMERICA',1,'CORE',1515,null),
(2939352761,'argentina-nacional-b','Argentina Nacional B','AR','SOUTH_AMERICA',2,'SUPPORT',1415,'argentina-liga-profesional'),
(650171110,'portugal-primeira-liga','Portugal Primeira Liga','PT','EUROPE',1,'CORE',1535,null),
(3795758275,'portugal-segunda-liga','Portugal Segunda Liga','PT','EUROPE',2,'SUPPORT',1425,'portugal-primeira-liga'),
(137325260,'netherlands-eredivisie','Netherlands Eredivisie','NL','EUROPE',1,'CORE',1525,null),
(3076036023,'netherlands-eerste-divisie','Netherlands Eerste Divisie','NL','EUROPE',2,'SUPPORT',1415,'netherlands-eredivisie'),
(3960966399,'belgium-pro-league','Belgium First Division A','BE','EUROPE',1,'SUPPORT',1505,null),
(2053283039,'turkey-super-lig','Türkiye Super Lig','TR','EUROPE',1,'CORE',1500,null),
(1885034716,'turkey-1-lig','Türkiye 1 Lig','TR','EUROPE',2,'SUPPORT',1405,'turkey-super-lig'),
(3962220103,'norway-eliteserien','Norway Eliteserien','NO','EUROPE',1,'SUPPORT',1465,null),
(806335738,'slovakia-super-liga','Slovakia Super Liga','SK','EUROPE',1,'SUPPORT',1425,null),
(2221499861,'usa-mls','USA MLS','US','NORTH_AMERICA',1,'CORE',1485,null),
(1989521627,'saudi-pro-league','Saudi Arabia Pro League','SA','ASIA',1,'CORE',1495,null),
(3413653140,'ecuador-ligapro-serie-a','Ecuador LigaPro Serie A','EC','SOUTH_AMERICA',1,'SUPPORT',1470,null),
(3119754895,'colombia-primera-a','Colombia Primera A','CO','SOUTH_AMERICA',1,'SUPPORT',1480,null),
(1126893247,'chile-liga-de-primera','Chile Liga de Primera','CL','SOUTH_AMERICA',1,'SUPPORT',1465,null),
(1920008143,'paraguay-division-profesional','Paraguay Division Profesional','PY','SOUTH_AMERICA',1,'SUPPORT',1455,null),
(3564886492,'peru-liga-1','Peru Liga 1','PE','SOUTH_AMERICA',1,'SUPPORT',1445,null),
(2673037034,'bolivia-primera-division','Bolivia Primera Division','BO','SOUTH_AMERICA',1,'SUPPORT',1435,null),
(3465992224,'venezuela-primera-division','Venezuela Primera Division','VE','SOUTH_AMERICA',1,'SUPPORT',1420,null)
on conflict(league_id) do update set
  league_key=excluded.league_key,league_name=excluded.league_name,country_code=excluded.country_code,
  region=excluded.region,division_level=excluded.division_level,focus_role=excluded.focus_role,
  prior_rating=excluded.prior_rating,parent_league_key=excluded.parent_league_key,active=true,updated_at=now();

create table if not exists public.elo_cross_competitions (
  competition_id bigint primary key,
  competition_name text not null,
  region text not null,
  active boolean not null default true,
  last_synced_at timestamptz,
  last_sync_status text,
  last_sync_error text
);

insert into public.elo_cross_competitions(competition_id,competition_name,region,active) values
(2187079931,'UEFA Champions League','EUROPE',true),
(1318331555,'UEFA Champions League Qualifying','EUROPE',true),
(2629778952,'UEFA Europa League','EUROPE',true),
(2515803737,'UEFA Europa League Qualifying','EUROPE',true),
(51996766,'UEFA Conference League','EUROPE',true),
(2009834352,'UEFA Conference League Qualifying','EUROPE',true),
(3899038422,'Copa Libertadores','SOUTH_AMERICA',true),
(2455214366,'Copa Libertadores Qualification','SOUTH_AMERICA',true),
(42854782,'Copa Sudamericana','SOUTH_AMERICA',true)
on conflict(competition_id) do update set
  competition_name=excluded.competition_name,region=excluded.region,active=excluded.active;

create table if not exists public.elo_cross_fixtures (
  competition_id bigint not null,
  competition_name text not null,
  region text not null,
  fixture_id bigint not null,
  kickoff_at timestamptz not null,
  home_team_id bigint not null,
  home_team_name text not null,
  away_team_id bigint not null,
  away_team_name text not null,
  home_goals integer not null,
  away_goals integer not null,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(competition_id,fixture_id)
);
create index if not exists elo_cross_fixtures_kickoff_idx on public.elo_cross_fixtures(kickoff_at);

create table if not exists public.elo_league_ratings (
  model_version text not null,
  league_id bigint not null,
  league_key text not null,
  league_name text not null,
  country_code text not null,
  region text not null,
  division_level integer not null,
  focus_role text not null,
  prior_rating numeric not null,
  rating numeric not null,
  evidence_adjustment numeric not null default 0,
  evidence_matches integer not null default 0,
  hierarchy_constrained boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(model_version,league_id)
);
create unique index if not exists elo_league_ratings_key_idx on public.elo_league_ratings(model_version,league_key);

create table if not exists public.elo_league_fixture_history (
  model_version text not null,
  competition_id bigint not null,
  competition_name text not null,
  fixture_id bigint not null,
  kickoff_at timestamptz not null,
  home_team_id bigint not null,
  away_team_id bigint not null,
  home_league_id bigint not null,
  away_league_id bigint not null,
  home_league_key text not null,
  away_league_key text not null,
  home_local_rating numeric not null,
  away_local_rating numeric not null,
  home_league_rating_before numeric not null,
  away_league_rating_before numeric not null,
  home_global_rating_before numeric not null,
  away_global_rating_before numeric not null,
  expected_home_score numeric not null,
  actual_home_score numeric not null,
  league_delta numeric not null,
  home_league_rating_after numeric not null,
  away_league_rating_after numeric not null,
  created_at timestamptz not null default now(),
  primary key(model_version,competition_id,fixture_id)
);
create index if not exists elo_league_fixture_history_time_idx on public.elo_league_fixture_history(model_version,kickoff_at);

create table if not exists public.elo_audit_runs (
  id uuid primary key default gen_random_uuid(),
  model_version text not null,
  generated_at timestamptz not null default now(),
  status text not null,
  summary jsonb not null,
  issues jsonb not null default '[]'::jsonb
);

alter table public.elo_prediction_context add column if not exists home_league_id bigint;
alter table public.elo_prediction_context add column if not exists away_league_id bigint;
alter table public.elo_prediction_context add column if not exists home_league_rating numeric;
alter table public.elo_prediction_context add column if not exists away_league_rating numeric;
alter table public.elo_prediction_context add column if not exists home_global_rating numeric;
alter table public.elo_prediction_context add column if not exists away_global_rating numeric;
alter table public.elo_prediction_context add column if not exists elo_scope text;

alter table public.elo_target_leagues enable row level security;
alter table public.elo_cross_competitions enable row level security;
alter table public.elo_cross_fixtures enable row level security;
alter table public.elo_league_ratings enable row level security;
alter table public.elo_league_fixture_history enable row level security;
alter table public.elo_audit_runs enable row level security;
revoke all on public.elo_target_leagues,public.elo_cross_competitions,public.elo_cross_fixtures,
  public.elo_league_ratings,public.elo_league_fixture_history,public.elo_audit_runs from anon,authenticated;

create or replace function public.elo_rebuild_league_ratings()
returns jsonb language plpgsql security definer set search_path='public' as $function$
declare
  f record; h_league_id bigint; a_league_id bigint; h_league_key text; a_league_key text;
  h_local double precision; a_local double precision; h_lr double precision; a_lr double precision;
  h_prior double precision; a_prior double precision; h_global double precision; a_global double precision;
  expected_h double precision; actual_h double precision; delta double precision; h_after double precision; a_after double precision;
  v_used integer:=0; v_skipped integer:=0; v_big5_min double precision;
begin
  delete from public.elo_league_fixture_history where model_version='league-elo-v1';
  delete from public.elo_league_ratings where model_version='league-elo-v1';
  insert into public.elo_league_ratings(model_version,league_id,league_key,league_name,country_code,region,division_level,focus_role,prior_rating,rating,evidence_adjustment,evidence_matches,hierarchy_constrained,updated_at)
  select 'league-elo-v1',league_id,league_key,league_name,country_code,region,division_level,focus_role,prior_rating,prior_rating,0,0,false,now()
  from public.elo_target_leagues where active;

  for f in select * from public.elo_cross_fixtures order by kickoff_at,competition_id,fixture_id loop
    h_league_id:=null; a_league_id:=null; h_local:=1500; a_local:=1500;
    select q.league_id,q.league_key,q.rating into h_league_id,h_league_key,h_local from (
      select e.league_id,e.league_key,case when e.home_team_id=f.home_team_id then e.home_rating_after::double precision else e.away_rating_after::double precision end rating,e.kickoff_at
      from public.elo_fixture_history e where e.model_version='elo-v1-w020' and e.kickoff_at<f.kickoff_at and (e.home_team_id=f.home_team_id or e.away_team_id=f.home_team_id)
      order by e.kickoff_at desc,e.fixture_id desc limit 1) q;
    select q.league_id,q.league_key,q.rating into a_league_id,a_league_key,a_local from (
      select e.league_id,e.league_key,case when e.home_team_id=f.away_team_id then e.home_rating_after::double precision else e.away_rating_after::double precision end rating,e.kickoff_at
      from public.elo_fixture_history e where e.model_version='elo-v1-w020' and e.kickoff_at<f.kickoff_at and (e.home_team_id=f.away_team_id or e.away_team_id=f.away_team_id)
      order by e.kickoff_at desc,e.fixture_id desc limit 1) q;
    if h_league_id is null or a_league_id is null or h_league_id=a_league_id then v_skipped:=v_skipped+1; continue; end if;
    select rating::double precision,prior_rating::double precision into h_lr,h_prior from public.elo_league_ratings where model_version='league-elo-v1' and league_id=h_league_id;
    select rating::double precision,prior_rating::double precision into a_lr,a_prior from public.elo_league_ratings where model_version='league-elo-v1' and league_id=a_league_id;
    if h_lr is null or a_lr is null then v_skipped:=v_skipped+1; continue; end if;
    h_global:=h_lr+(h_local-1500); a_global:=a_lr+(a_local-1500);
    expected_h:=1/(1+power(10.0,(a_global-h_global-60)/400));
    actual_h:=case when f.home_goals>f.away_goals then 1 when f.home_goals=f.away_goals then 0.5 else 0 end;
    delta:=6*(actual_h-expected_h);
    h_after:=greatest(h_prior-60,least(h_prior+60,h_lr+delta));
    a_after:=greatest(a_prior-60,least(a_prior+60,a_lr-delta));
    update public.elo_league_ratings set rating=h_after,evidence_matches=evidence_matches+1,updated_at=now() where model_version='league-elo-v1' and league_id=h_league_id;
    update public.elo_league_ratings set rating=a_after,evidence_matches=evidence_matches+1,updated_at=now() where model_version='league-elo-v1' and league_id=a_league_id;
    insert into public.elo_league_fixture_history(model_version,competition_id,competition_name,fixture_id,kickoff_at,home_team_id,away_team_id,home_league_id,away_league_id,home_league_key,away_league_key,home_local_rating,away_local_rating,home_league_rating_before,away_league_rating_before,home_global_rating_before,away_global_rating_before,expected_home_score,actual_home_score,league_delta,home_league_rating_after,away_league_rating_after)
    values('league-elo-v1',f.competition_id,f.competition_name,f.fixture_id,f.kickoff_at,f.home_team_id,f.away_team_id,h_league_id,a_league_id,h_league_key,a_league_key,h_local,a_local,h_lr,a_lr,h_global,a_global,expected_h,actual_h,delta,h_after,a_after)
    on conflict(model_version,competition_id,fixture_id) do update set home_league_id=excluded.home_league_id,away_league_id=excluded.away_league_id,home_local_rating=excluded.home_local_rating,away_local_rating=excluded.away_local_rating,home_league_rating_before=excluded.home_league_rating_before,away_league_rating_before=excluded.away_league_rating_before,home_global_rating_before=excluded.home_global_rating_before,away_global_rating_before=excluded.away_global_rating_before,expected_home_score=excluded.expected_home_score,actual_home_score=excluded.actual_home_score,league_delta=excluded.league_delta,home_league_rating_after=excluded.home_league_rating_after,away_league_rating_after=excluded.away_league_rating_after,created_at=now();
    v_used:=v_used+1;
  end loop;

  update public.elo_league_ratings child set hierarchy_constrained=child.rating>parent.rating-70,rating=least(child.rating,parent.rating-70),updated_at=now()
  from public.elo_target_leagues cfg join public.elo_league_ratings parent on parent.model_version='league-elo-v1' and parent.league_key=cfg.parent_league_key
  where child.model_version='league-elo-v1' and child.league_id=cfg.league_id and cfg.parent_league_key is not null;

  select min(rating::double precision) into v_big5_min from public.elo_league_ratings
  where model_version='league-elo-v1' and league_key in ('england-premier-league','spain-la-liga','germany-bundesliga','italy-serie-a','france-ligue-1');
  update public.elo_league_ratings set hierarchy_constrained=hierarchy_constrained or rating>v_big5_min-25,rating=least(rating,v_big5_min-25),updated_at=now()
  where model_version='league-elo-v1' and focus_role='CORE' and division_level>=2 and v_big5_min is not null;
  update public.elo_league_ratings set evidence_adjustment=rating-prior_rating,updated_at=now() where model_version='league-elo-v1';
  return jsonb_build_object('status','OK','interleagueMatchesUsed',v_used,'skipped',v_skipped,'big5Floor',v_big5_min,'leagues',(select count(*) from public.elo_league_ratings where model_version='league-elo-v1'));
end $function$;

create or replace view public.elo_global_team_ratings as
select t.model_version team_model_version,t.league_id,t.league_key,t.league_name,t.team_id,t.team_name,t.rating local_rating,l.rating league_rating,l.rating+(t.rating-1500) global_rating,t.matches_processed,t.first_fixture_at,t.last_fixture_at,t.updated_at
from public.elo_team_ratings t join public.elo_league_ratings l on l.model_version='league-elo-v1' and l.league_id=t.league_id
where t.model_version='elo-v1-w020';

drop view if exists public.elo_audit_leagues;
create view public.elo_audit_leagues as
select cfg.league_id,cfg.league_key,cfg.league_name,cfg.country_code,cfg.region,cfg.division_level,cfg.focus_role,cfg.prior_rating,cfg.parent_league_key,cfg.last_synced_at,cfg.last_sync_status,cfg.last_sync_error,
count(t.team_id)::integer teams,avg(t.rating) local_avg_rating,min(t.rating) local_min_rating,max(t.rating) local_max_rating,max(t.last_fixture_at) last_fixture_at,
lr.rating league_rating,lr.evidence_adjustment,lr.evidence_matches,lr.hierarchy_constrained,parent.rating parent_league_rating,
case when cfg.parent_league_key is null then true else lr.rating<=parent.rating-70 end hierarchy_ok,
case when cfg.last_sync_status='ERROR' then 'SYNC_ERROR' when count(t.team_id)=0 then 'NO_TEAM_ELO' when abs(coalesce(avg(t.rating),1500)-1500)>1 then 'LOCAL_MEAN_DRIFT' when min(t.rating)<1200 or max(t.rating)>1850 then 'TEAM_RANGE_OUTLIER' when cfg.parent_league_key is not null and not(lr.rating<=parent.rating-70) then 'HIERARCHY_VIOLATION' else 'OK' end audit_status
from public.elo_target_leagues cfg
left join public.elo_team_ratings t on t.model_version='elo-v1-w020' and t.league_id=cfg.league_id
left join public.elo_league_ratings lr on lr.model_version='league-elo-v1' and lr.league_id=cfg.league_id
left join public.elo_league_ratings parent on parent.model_version='league-elo-v1' and parent.league_key=cfg.parent_league_key
where cfg.active
group by cfg.league_id,cfg.league_key,cfg.league_name,cfg.country_code,cfg.region,cfg.division_level,cfg.focus_role,cfg.prior_rating,cfg.parent_league_key,cfg.last_synced_at,cfg.last_sync_status,cfg.last_sync_error,lr.rating,lr.evidence_adjustment,lr.evidence_matches,lr.hierarchy_constrained,parent.rating;

create or replace function public.elo_run_audit()
returns jsonb language plpgsql security definer set search_path='public' as $function$
declare s jsonb; i jsonb; st text; rid uuid;
begin
  select jsonb_build_object('targetLeagues',count(*),'leaguesWithTeamElo',count(*) filter(where teams>0),'teams',coalesce(sum(teams),0),'leagueRatings',count(*) filter(where league_rating is not null),'hierarchyViolations',count(*) filter(where hierarchy_ok=false),'syncErrors',count(*) filter(where last_sync_status='ERROR'),'auditIssues',count(*) filter(where audit_status<>'OK'),'crossTargets',(select count(*) from public.elo_cross_competitions where active),'crossSyncErrors',(select count(*) from public.elo_cross_competitions where active and last_sync_status='ERROR'),'crossFixturesStored',(select count(*) from public.elo_cross_fixtures),'crossFixturesUsed',(select count(*) from public.elo_league_fixture_history where model_version='league-elo-v1'),'latestTeamFixture',max(last_fixture_at)) into s from public.elo_audit_leagues;
  select coalesce(jsonb_agg(jsonb_build_object('leagueKey',league_key,'leagueName',league_name,'status',audit_status,'syncStatus',last_sync_status,'syncError',last_sync_error,'teams',teams,'localAvg',local_avg_rating,'localMin',local_min_rating,'localMax',local_max_rating,'leagueRating',league_rating,'parent',parent_league_key,'parentRating',parent_league_rating,'hierarchyOk',hierarchy_ok)) filter(where audit_status<>'OK'),'[]'::jsonb) into i from public.elo_audit_leagues;
  st:=case when jsonb_array_length(i)=0 and (select count(*) from public.elo_cross_competitions where active and last_sync_status='ERROR')=0 then 'OK' else 'ATTENTION' end;
  insert into public.elo_audit_runs(model_version,status,summary,issues) values('hierarchical-elo-v1',st,s,i) returning id into rid;
  return jsonb_build_object('id',rid,'status',st,'summary',s,'issues',i);
end $function$;

-- One domestic target per invocation; pg_sleep keeps Pro usage below 10 req/min.
create or replace function public.elo_sync_domestic_league(p_league_id bigint)
returns jsonb language plpgsql security definer set search_path='public','extensions','vault' as $function$
declare t record; k text; r extensions.http_response; p jsonb; f jsonb; page int:=1; more boolean; latest timestamptz; st bigint; en bigint:=floor(extract(epoch from now()))::bigint; boot bigint:=floor(extract(epoch from now()-interval '365 days'))::bigint; cnt int:=0; req int:=0; fid bigint; hid bigint; aid bigint; ko timestamptz; hn text; an text; hg int; ag int; url text; rebuild jsonb;
begin
  select * into t from public.elo_target_leagues where league_id=p_league_id and active; if not found then return jsonb_build_object('status','NOT_TARGET'); end if;
  select decrypted_secret into k from vault.decrypted_secrets where name='elo_five_dollar_api_key' order by created_at desc limit 1; if k is null then raise exception '5Dollar secret ausente'; end if;
  update public.elo_target_leagues set last_sync_status='RUNNING',last_sync_error=null where league_id=p_league_id;
  select max(kickoff_at) into latest from public.elo_fixtures where source='five_dollar_football' and league_id=p_league_id;
  st:=case when latest is null then boot else greatest(boot,floor(extract(epoch from latest-interval '3 days'))::bigint) end;
  loop
    perform pg_sleep(6.2); url:='https://api.5dollarfootballapi.com/v1/leagues/'||p_league_id||'/fixtures?status=finished&start_time='||st||'&end_time='||en||'&page='||page||'&per_page=100';
    select * into r from extensions.http((row('GET'::extensions.http_method,url,array[row('Accept','application/json')::extensions.http_header,row('Authorization','Bearer '||k)::extensions.http_header],null,null)::extensions.http_request)); req:=req+1;
    if r.status=429 then raise exception '5Dollar 429'; end if; if r.status<200 or r.status>=300 then raise exception 'HTTP %: %',r.status,left(r.content,200); end if; p:=r.content::jsonb;
    for f in select value from jsonb_array_elements(coalesce(p->'data','[]'::jsonb)) loop
      if lower(coalesce(f->>'status',''))<>'finished' then continue; end if;
      fid:=nullif(f->>'id','')::bigint; hid:=nullif(f#>>'{teams,home,id}','')::bigint; aid:=nullif(f#>>'{teams,away,id}','')::bigint; hn:=f#>>'{teams,home,name}'; an:=f#>>'{teams,away,name}'; hg:=nullif(f#>>'{goals,home}','')::int; ag:=nullif(f#>>'{goals,away}','')::int;
      if nullif(f->>'kickoff_ts','') is not null then ko:=to_timestamp((f->>'kickoff_ts')::double precision); elsif nullif(f->>'kickoff_utc','') is not null then ko:=(f->>'kickoff_utc')::timestamptz; else ko:=null; end if;
      if fid is null or hid is null or aid is null or hn is null or an is null or hg is null or ag is null or ko is null then continue; end if;
      insert into public.elo_fixtures(source,league_id,league_key,league_name,country_code,fixture_id,kickoff_at,home_team_id,home_team_name,away_team_id,away_team_name,home_goals,away_goals,fetched_at,updated_at)
      values('five_dollar_football',t.league_id,t.league_key,t.league_name,t.country_code,fid,ko,hid,hn,aid,an,hg,ag,now(),now())
      on conflict(source,league_id,fixture_id) do update set kickoff_at=excluded.kickoff_at,home_team_id=excluded.home_team_id,home_team_name=excluded.home_team_name,away_team_id=excluded.away_team_id,away_team_name=excluded.away_team_name,home_goals=excluded.home_goals,away_goals=excluded.away_goals,fetched_at=excluded.fetched_at,updated_at=now(); cnt:=cnt+1;
    end loop;
    more:=coalesce((p#>>'{pagination,has_more}')::boolean,false); exit when not more; page:=page+1;
  end loop;
  rebuild:=public.elo_rebuild_league(p_league_id); update public.elo_target_leagues set last_synced_at=now(),last_sync_status='OK',last_sync_error=null,updated_at=now() where league_id=p_league_id;
  return jsonb_build_object('status','OK','leagueId',p_league_id,'leagueKey',t.league_key,'requests',req,'fixturesUpserted',cnt,'rebuild',rebuild);
exception when others then update public.elo_target_leagues set last_synced_at=now(),last_sync_status='ERROR',last_sync_error=sqlerrm,updated_at=now() where league_id=p_league_id; return jsonb_build_object('status','ERROR','leagueId',p_league_id,'error',sqlerrm,'requests',req); end $function$;

create or replace function public.elo_sync_cross_competition(p_competition_id bigint)
returns jsonb language plpgsql security definer set search_path='public','extensions','vault' as $function$
declare c record; k text; r extensions.http_response; p jsonb; f jsonb; page int:=1; more boolean; latest timestamptz; st bigint; en bigint:=floor(extract(epoch from now()))::bigint; boot bigint:=floor(extract(epoch from now()-interval '365 days'))::bigint; cnt int:=0; req int:=0; fid bigint; hid bigint; aid bigint; ko timestamptz; hn text; an text; hg int; ag int; url text;
begin
  select * into c from public.elo_cross_competitions where competition_id=p_competition_id and active; if not found then return jsonb_build_object('status','NOT_TARGET'); end if;
  select decrypted_secret into k from vault.decrypted_secrets where name='elo_five_dollar_api_key' order by created_at desc limit 1; if k is null then raise exception '5Dollar secret ausente'; end if;
  update public.elo_cross_competitions set last_sync_status='RUNNING',last_sync_error=null where competition_id=p_competition_id;
  select max(kickoff_at) into latest from public.elo_cross_fixtures where competition_id=p_competition_id; st:=case when latest is null then boot else greatest(boot,floor(extract(epoch from latest-interval '3 days'))::bigint) end;
  loop
    perform pg_sleep(6.2); url:='https://api.5dollarfootballapi.com/v1/leagues/'||p_competition_id||'/fixtures?status=finished&start_time='||st||'&end_time='||en||'&page='||page||'&per_page=100';
    select * into r from extensions.http((row('GET'::extensions.http_method,url,array[row('Accept','application/json')::extensions.http_header,row('Authorization','Bearer '||k)::extensions.http_header],null,null)::extensions.http_request)); req:=req+1;
    if r.status=429 then raise exception '5Dollar 429'; end if; if r.status<200 or r.status>=300 then raise exception 'HTTP %: %',r.status,left(r.content,200); end if; p:=r.content::jsonb;
    for f in select value from jsonb_array_elements(coalesce(p->'data','[]'::jsonb)) loop
      if lower(coalesce(f->>'status',''))<>'finished' then continue; end if;
      fid:=nullif(f->>'id','')::bigint; hid:=nullif(f#>>'{teams,home,id}','')::bigint; aid:=nullif(f#>>'{teams,away,id}','')::bigint; hn:=f#>>'{teams,home,name}'; an:=f#>>'{teams,away,name}'; hg:=nullif(f#>>'{goals,home}','')::int; ag:=nullif(f#>>'{goals,away}','')::int;
      if nullif(f->>'kickoff_ts','') is not null then ko:=to_timestamp((f->>'kickoff_ts')::double precision); elsif nullif(f->>'kickoff_utc','') is not null then ko:=(f->>'kickoff_utc')::timestamptz; else ko:=null; end if;
      if fid is null or hid is null or aid is null or hn is null or an is null or hg is null or ag is null or ko is null then continue; end if;
      insert into public.elo_cross_fixtures(competition_id,competition_name,region,fixture_id,kickoff_at,home_team_id,home_team_name,away_team_id,away_team_name,home_goals,away_goals,fetched_at,updated_at)
      values(c.competition_id,c.competition_name,c.region,fid,ko,hid,hn,aid,an,hg,ag,now(),now()) on conflict(competition_id,fixture_id) do update set kickoff_at=excluded.kickoff_at,home_team_id=excluded.home_team_id,home_team_name=excluded.home_team_name,away_team_id=excluded.away_team_id,away_team_name=excluded.away_team_name,home_goals=excluded.home_goals,away_goals=excluded.away_goals,fetched_at=excluded.fetched_at,updated_at=now(); cnt:=cnt+1;
    end loop;
    more:=coalesce((p#>>'{pagination,has_more}')::boolean,false); exit when not more; page:=page+1;
  end loop;
  update public.elo_cross_competitions set last_synced_at=now(),last_sync_status='OK',last_sync_error=null where competition_id=p_competition_id; return jsonb_build_object('status','OK','competitionId',p_competition_id,'competitionName',c.competition_name,'requests',req,'fixturesUpserted',cnt);
exception when others then update public.elo_cross_competitions set last_synced_at=now(),last_sync_status='ERROR',last_sync_error=sqlerrm where competition_id=p_competition_id; return jsonb_build_object('status','ERROR','competitionId',p_competition_id,'error',sqlerrm,'requests',req); end $function$;

create or replace function public.elo_sync_next_target()
returns jsonb language plpgsql security definer set search_path='public' as $function$
declare kind text; id bigint; r jsonb;
begin
  if not pg_try_advisory_xact_lock(56099123) then return jsonb_build_object('status','BUSY'); end if;
  select q.kind,q.id into kind,id from (
    select 'DOMESTIC' kind,league_id id,last_synced_at,case when focus_role='CORE' then 0 else 1 end priority from public.elo_target_leagues where active and (last_synced_at is null or (last_synced_at at time zone 'America/Sao_Paulo')::date<(now() at time zone 'America/Sao_Paulo')::date)
    union all select 'CROSS',competition_id,last_synced_at,0 from public.elo_cross_competitions where active and (last_synced_at is null or (last_synced_at at time zone 'America/Sao_Paulo')::date<(now() at time zone 'America/Sao_Paulo')::date)
  ) q order by priority,last_synced_at nulls first,id limit 1;
  if id is null then return jsonb_build_object('status','ALL_CURRENT'); end if;
  if kind='DOMESTIC' then r:=public.elo_sync_domestic_league(id); else r:=public.elo_sync_cross_competition(id); end if;
  return jsonb_build_object('kind',kind,'id',id,'result',r);
end $function$;

create or replace function public.elo_finalize_daily()
returns jsonb language plpgsql security definer set search_path='public' as $function$
declare l jsonb; a jsonb; pending int;
begin
  select count(*) into pending from (select league_id from public.elo_target_leagues where active and (last_synced_at is null or (last_synced_at at time zone 'America/Sao_Paulo')::date<(now() at time zone 'America/Sao_Paulo')::date) union all select competition_id from public.elo_cross_competitions where active and (last_synced_at is null or (last_synced_at at time zone 'America/Sao_Paulo')::date<(now() at time zone 'America/Sao_Paulo')::date)) p;
  l:=public.elo_rebuild_league_ratings(); a:=public.elo_run_audit();
  update public.elo_sync_state set model_version='hierarchical-elo-v1',last_completed_at=now(),last_status=case when pending=0 then 'OK' else 'PARTIAL' end,leagues_processed=(select count(*) from public.elo_target_leagues where active and last_sync_status='OK'),fixtures_fetched=(select count(*) from public.elo_fixtures),api_requests=0,error_message=case when pending=0 then null else pending||' alvo(s) pendente(s)' end,details=jsonb_build_object('pendingTargets',pending,'leagueRatings',l,'audit',a),updated_at=now() where id='main';
  return jsonb_build_object('status',case when pending=0 then 'OK' else 'PARTIAL' end,'pendingTargets',pending,'leagueRatings',l,'audit',a);
end $function$;

create or replace function public.elo_sync_from_5dollar()
returns jsonb language plpgsql security definer set search_path='public' as $function$ begin return public.elo_sync_next_target(); end $function$;

-- Replace the previous monolithic 03:00 job. 60 two-minute slots are enough for
-- the target set, then a 05:05 BRT finalize/audit runs after the queue.
do $$ begin perform cron.unschedule('elo-daily-0500-brazil'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('elo-daily-incremental'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('elo-daily-finalize'); exception when others then null; end $$;
select cron.schedule('elo-daily-incremental','*/2 6-7 * * *','select public.elo_sync_next_target();');
select cron.schedule('elo-daily-finalize','5 8 * * *','select public.elo_finalize_daily();');
