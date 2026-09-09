-- Harden the hierarchical Elo ledger after the 2026-09-08 rollout.
--
-- Goals:
-- 1) keep domestic team/history metadata canonical with elo_target_leagues;
-- 2) audit team-ledger integrity explicitly, not only league aggregates;
-- 3) enforce/measure the intended division hierarchy in the audit;
-- 4) retry transient same-day sync errors without starving untouched targets;
-- 5) never report the daily finalize as OK while a target errored or the audit is ATTENTION.

-- Repair the only kind of metadata drift that can survive an upsert when a
-- canonical league key/name changes (observed for Italy Serie A).
UPDATE public.elo_fixtures f
SET league_key = cfg.league_key,
    league_name = cfg.league_name,
    country_code = cfg.country_code,
    updated_at = now()
FROM public.elo_target_leagues cfg
WHERE cfg.active
  AND cfg.league_id = f.league_id
  AND f.source = 'five_dollar_football'
  AND (f.league_key IS DISTINCT FROM cfg.league_key
    OR f.league_name IS DISTINCT FROM cfg.league_name
    OR f.country_code IS DISTINCT FROM cfg.country_code);

UPDATE public.elo_fixture_history h
SET league_key = cfg.league_key,
    league_name = cfg.league_name
FROM public.elo_target_leagues cfg
WHERE cfg.active
  AND cfg.league_id = h.league_id
  AND h.model_version = 'elo-v1-w020'
  AND (h.league_key IS DISTINCT FROM cfg.league_key
    OR h.league_name IS DISTINCT FROM cfg.league_name);

UPDATE public.elo_team_ratings t
SET league_key = cfg.league_key,
    league_name = cfg.league_name,
    updated_at = now()
FROM public.elo_target_leagues cfg
WHERE cfg.active
  AND cfg.league_id = t.league_id
  AND t.model_version = 'elo-v1-w020'
  AND (t.league_key IS DISTINCT FROM cfg.league_key
    OR t.league_name IS DISTINCT FROM cfg.league_name);

-- Rebuild domestic Elo using canonical target metadata instead of trusting
-- historical fixture labels. Numeric Elo math remains unchanged.
CREATE OR REPLACE FUNCTION public.elo_rebuild_league(p_league_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cfg record;
  f record;
  h_rating double precision;
  a_rating double precision;
  h_after double precision;
  a_after double precision;
  ha double precision;
  expected_h double precision;
  actual_h double precision;
  delta double precision;
  prior_home_sum double precision := 0;
  prior_matches integer := 0;
  p double precision;
  v_teams integer;
  v_seeded integer := 0;
BEGIN
  SELECT * INTO cfg
  FROM public.elo_target_leagues
  WHERE league_id = p_league_id AND active;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_TARGET','fixtures',0,'teams',0,'seededTransitions',0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.elo_fixtures
    WHERE source='five_dollar_football' AND league_id=p_league_id
  ) THEN
    RETURN jsonb_build_object(
      'status','NO_FIXTURES','fixtures',0,'teams',0,
      'leagueKey',cfg.league_key,'leagueName',cfg.league_name,'seededTransitions',0
    );
  END IF;

  DELETE FROM public.elo_fixture_history
  WHERE model_version='elo-v1-w020' AND league_id=p_league_id;

  DELETE FROM public.elo_team_ratings
  WHERE model_version='elo-v1-w020' AND league_id=p_league_id;

  FOR f IN
    SELECT *
    FROM public.elo_fixtures
    WHERE source='five_dollar_football' AND league_id=p_league_id
    ORDER BY kickoff_at, fixture_id
  LOOP
    SELECT rating::double precision INTO h_rating
    FROM public.elo_team_ratings
    WHERE model_version='elo-v1-w020'
      AND league_id=p_league_id
      AND team_id=f.home_team_id;

    IF h_rating IS NULL THEN
      h_rating := public.elo_seed_rating(f.home_team_id,p_league_id,f.kickoff_at);
      IF abs(h_rating-1500) > 0.000001 THEN v_seeded := v_seeded + 1; END IF;
    END IF;

    SELECT rating::double precision INTO a_rating
    FROM public.elo_team_ratings
    WHERE model_version='elo-v1-w020'
      AND league_id=p_league_id
      AND team_id=f.away_team_id;

    IF a_rating IS NULL THEN
      a_rating := public.elo_seed_rating(f.away_team_id,p_league_id,f.kickoff_at);
      IF abs(a_rating-1500) > 0.000001 THEN v_seeded := v_seeded + 1; END IF;
    END IF;

    IF prior_matches < 30 THEN
      ha := 60;
    ELSE
      p := greatest(0.5,least(0.665,prior_home_sum/prior_matches));
      ha := greatest(0,least(120,400*(ln(p/(1-p))/ln(10.0))));
    END IF;

    expected_h := 1.0/(1.0+power(10.0,(a_rating-h_rating-ha)/400.0));
    actual_h := CASE
      WHEN f.home_goals > f.away_goals THEN 1.0
      WHEN f.home_goals = f.away_goals THEN 0.5
      ELSE 0.0
    END;
    delta := 20.0*(actual_h-expected_h);
    h_after := h_rating+delta;
    a_after := a_rating-delta;

    INSERT INTO public.elo_fixture_history(
      model_version,league_id,league_key,league_name,fixture_id,kickoff_at,
      home_team_id,home_team_name,away_team_id,away_team_name,home_goals,away_goals,
      home_rating_before,away_rating_before,home_rating_after,away_rating_after,
      home_advantage_points,expected_home_score,actual_home_score,elo_delta
    ) VALUES (
      'elo-v1-w020',p_league_id,cfg.league_key,cfg.league_name,f.fixture_id,f.kickoff_at,
      f.home_team_id,f.home_team_name,f.away_team_id,f.away_team_name,f.home_goals,f.away_goals,
      h_rating,a_rating,h_after,a_after,ha,expected_h,actual_h,delta
    );

    INSERT INTO public.elo_team_ratings(
      model_version,league_id,league_key,league_name,team_id,team_name,rating,
      matches_processed,first_fixture_at,last_fixture_at,updated_at
    ) VALUES (
      'elo-v1-w020',p_league_id,cfg.league_key,cfg.league_name,
      f.home_team_id,f.home_team_name,h_after,1,f.kickoff_at,f.kickoff_at,now()
    )
    ON CONFLICT(model_version,league_id,team_id) DO UPDATE SET
      league_key=excluded.league_key,
      league_name=excluded.league_name,
      team_name=excluded.team_name,
      rating=excluded.rating,
      matches_processed=public.elo_team_ratings.matches_processed+1,
      last_fixture_at=excluded.last_fixture_at,
      updated_at=now();

    INSERT INTO public.elo_team_ratings(
      model_version,league_id,league_key,league_name,team_id,team_name,rating,
      matches_processed,first_fixture_at,last_fixture_at,updated_at
    ) VALUES (
      'elo-v1-w020',p_league_id,cfg.league_key,cfg.league_name,
      f.away_team_id,f.away_team_name,a_after,1,f.kickoff_at,f.kickoff_at,now()
    )
    ON CONFLICT(model_version,league_id,team_id) DO UPDATE SET
      league_key=excluded.league_key,
      league_name=excluded.league_name,
      team_name=excluded.team_name,
      rating=excluded.rating,
      matches_processed=public.elo_team_ratings.matches_processed+1,
      last_fixture_at=excluded.last_fixture_at,
      updated_at=now();

    prior_home_sum := prior_home_sum + actual_h;
    prior_matches := prior_matches + 1;
  END LOOP;

  SELECT count(*) INTO v_teams
  FROM public.elo_team_ratings
  WHERE model_version='elo-v1-w020' AND league_id=p_league_id;

  RETURN jsonb_build_object(
    'status','OK','fixtures',prior_matches,'teams',v_teams,
    'leagueKey',cfg.league_key,'leagueName',cfg.league_name,
    'seededTransitions',v_seeded
  );
END
$function$;

-- Future domestic upserts must also repair canonical metadata on conflicts.
CREATE OR REPLACE FUNCTION public.elo_sync_domestic_league(p_league_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault'
AS $function$
DECLARE
  t record;
  v_key text;
  v_resp extensions.http_response;
  v_payload jsonb;
  f jsonb;
  v_page int := 1;
  v_more boolean;
  v_latest timestamptz;
  v_start bigint;
  v_end bigint := floor(extract(epoch from now()))::bigint;
  v_boot bigint := floor(extract(epoch from now()-interval '365 days'))::bigint;
  v_count int := 0;
  v_req int := 0;
  v_id bigint;
  v_h bigint;
  v_a bigint;
  v_k timestamptz;
  v_hn text;
  v_an text;
  v_hg int;
  v_ag int;
  v_url text;
  v_rebuild jsonb;
BEGIN
  SELECT * INTO t
  FROM public.elo_target_leagues
  WHERE league_id=p_league_id AND active;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','NOT_TARGET'); END IF;

  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name='elo_five_dollar_api_key'
  ORDER BY created_at DESC LIMIT 1;
  IF v_key IS NULL THEN RAISE EXCEPTION '5Dollar secret ausente'; END IF;

  UPDATE public.elo_target_leagues
  SET last_sync_status='RUNNING',last_sync_error=NULL
  WHERE league_id=p_league_id;

  SELECT max(kickoff_at) INTO v_latest
  FROM public.elo_fixtures
  WHERE source='five_dollar_football' AND league_id=p_league_id;

  v_start := CASE
    WHEN v_latest IS NULL THEN v_boot
    ELSE greatest(v_boot,floor(extract(epoch from v_latest-interval '3 days'))::bigint)
  END;

  LOOP
    PERFORM pg_sleep(6.2);
    v_url := 'https://api.5dollarfootballapi.com/v1/leagues/'||p_league_id||
      '/fixtures?status=finished&start_time='||v_start||'&end_time='||v_end||
      '&page='||v_page||'&per_page=100';

    SELECT * INTO v_resp
    FROM extensions.http((row(
      'GET'::extensions.http_method,
      v_url,
      array[
        row('Accept','application/json')::extensions.http_header,
        row('Authorization','Bearer '||v_key)::extensions.http_header
      ],
      NULL,NULL
    )::extensions.http_request));
    v_req := v_req + 1;

    IF v_resp.status=429 THEN RAISE EXCEPTION '5Dollar 429'; END IF;
    IF v_resp.status<200 OR v_resp.status>=300 THEN
      RAISE EXCEPTION 'HTTP %: %',v_resp.status,left(v_resp.content,200);
    END IF;

    v_payload := v_resp.content::jsonb;
    FOR f IN SELECT value FROM jsonb_array_elements(coalesce(v_payload->'data','[]'::jsonb)) LOOP
      IF lower(coalesce(f->>'status','')) <> 'finished' THEN CONTINUE; END IF;
      v_id := nullif(f->>'id','')::bigint;
      v_h := nullif(f#>>'{teams,home,id}','')::bigint;
      v_a := nullif(f#>>'{teams,away,id}','')::bigint;
      v_hn := f#>>'{teams,home,name}';
      v_an := f#>>'{teams,away,name}';
      v_hg := nullif(f#>>'{goals,home}','')::int;
      v_ag := nullif(f#>>'{goals,away}','')::int;
      IF nullif(f->>'kickoff_ts','') IS NOT NULL THEN
        v_k := to_timestamp((f->>'kickoff_ts')::double precision);
      ELSIF nullif(f->>'kickoff_utc','') IS NOT NULL THEN
        v_k := (f->>'kickoff_utc')::timestamptz;
      ELSE
        v_k := NULL;
      END IF;
      IF v_id IS NULL OR v_h IS NULL OR v_a IS NULL OR v_hn IS NULL OR v_an IS NULL
         OR v_hg IS NULL OR v_ag IS NULL OR v_k IS NULL THEN CONTINUE; END IF;

      INSERT INTO public.elo_fixtures(
        source,league_id,league_key,league_name,country_code,fixture_id,kickoff_at,
        home_team_id,home_team_name,away_team_id,away_team_name,home_goals,away_goals,
        fetched_at,updated_at
      ) VALUES (
        'five_dollar_football',t.league_id,t.league_key,t.league_name,t.country_code,
        v_id,v_k,v_h,v_hn,v_a,v_an,v_hg,v_ag,now(),now()
      )
      ON CONFLICT(source,league_id,fixture_id) DO UPDATE SET
        league_key=excluded.league_key,
        league_name=excluded.league_name,
        country_code=excluded.country_code,
        kickoff_at=excluded.kickoff_at,
        home_team_id=excluded.home_team_id,
        home_team_name=excluded.home_team_name,
        away_team_id=excluded.away_team_id,
        away_team_name=excluded.away_team_name,
        home_goals=excluded.home_goals,
        away_goals=excluded.away_goals,
        fetched_at=excluded.fetched_at,
        updated_at=now();
      v_count := v_count + 1;
    END LOOP;

    v_more := coalesce((v_payload#>>'{pagination,has_more}')::boolean,false);
    EXIT WHEN NOT v_more;
    v_page := v_page + 1;
  END LOOP;

  v_rebuild := public.elo_rebuild_league(p_league_id);
  UPDATE public.elo_target_leagues
  SET last_synced_at=now(),last_sync_status='OK',last_sync_error=NULL,updated_at=now()
  WHERE league_id=p_league_id;

  RETURN jsonb_build_object(
    'status','OK','leagueId',p_league_id,'leagueKey',t.league_key,
    'requests',v_req,'fixturesUpserted',v_count,'rebuild',v_rebuild
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.elo_target_leagues
  SET last_synced_at=now(),last_sync_status='ERROR',last_sync_error=sqlerrm,updated_at=now()
  WHERE league_id=p_league_id;
  RETURN jsonb_build_object(
    'status','ERROR','leagueId',p_league_id,'error',sqlerrm,'requests',v_req
  );
END
$function$;

-- Explicit team-ledger integrity audit. The current snapshot must match the
-- latest history event, fixture boundaries and history count for every team.
CREATE OR REPLACE VIEW public.elo_team_integrity_audit AS
WITH events AS (
  SELECT model_version,league_id,home_team_id AS team_id,fixture_id,kickoff_at,
         home_rating_after AS rating_after
  FROM public.elo_fixture_history
  WHERE model_version='elo-v1-w020'
  UNION ALL
  SELECT model_version,league_id,away_team_id AS team_id,fixture_id,kickoff_at,
         away_rating_after AS rating_after
  FROM public.elo_fixture_history
  WHERE model_version='elo-v1-w020'
),
agg AS (
  SELECT model_version,league_id,team_id,count(*)::integer AS history_matches,
         min(kickoff_at) AS first_history_fixture,
         max(kickoff_at) AS last_history_fixture
  FROM events
  GROUP BY model_version,league_id,team_id
),
latest AS (
  SELECT DISTINCT ON (model_version,league_id,team_id)
         model_version,league_id,team_id,kickoff_at,fixture_id,rating_after
  FROM events
  ORDER BY model_version,league_id,team_id,kickoff_at DESC,fixture_id DESC
)
SELECT
  count(*)::integer AS team_rows,
  count(*) FILTER (WHERE t.matches_processed<=0)::integer AS zero_match_rows,
  count(*) FILTER (WHERE a.team_id IS NULL)::integer AS missing_history_rows,
  count(*) FILTER (WHERE t.matches_processed IS DISTINCT FROM a.history_matches)::integer AS match_count_mismatch_rows,
  count(*) FILTER (WHERE t.first_fixture_at IS DISTINCT FROM a.first_history_fixture)::integer AS first_fixture_mismatch_rows,
  count(*) FILTER (WHERE t.last_fixture_at IS DISTINCT FROM a.last_history_fixture)::integer AS last_fixture_mismatch_rows,
  count(*) FILTER (WHERE abs(t.rating-l.rating_after)>0.000001)::integer AS rating_mismatch_rows,
  count(*) FILTER (WHERE cfg.league_id IS NULL)::integer AS orphan_target_rows,
  count(*) FILTER (
    WHERE cfg.league_id IS NOT NULL
      AND (t.league_key IS DISTINCT FROM cfg.league_key OR t.league_name IS DISTINCT FROM cfg.league_name)
  )::integer AS metadata_mismatch_rows,
  min(t.matches_processed)::integer AS min_matches_processed,
  max(t.matches_processed)::integer AS max_matches_processed,
  min(t.rating) AS min_rating,
  max(t.rating) AS max_rating
FROM public.elo_team_ratings t
LEFT JOIN agg a
  ON a.model_version=t.model_version AND a.league_id=t.league_id AND a.team_id=t.team_id
LEFT JOIN latest l
  ON l.model_version=t.model_version AND l.league_id=t.league_id AND l.team_id=t.team_id
LEFT JOIN public.elo_target_leagues cfg
  ON cfg.league_id=t.league_id AND cfg.active
WHERE t.model_version='elo-v1-w020';

REVOKE ALL ON public.elo_team_integrity_audit FROM anon, authenticated;

-- Retry only after all untouched targets have priority. Same-day failures are
-- eligible again after 10 minutes, so transient API failures do not silently
-- wait until the following day and do not starve the normal queue.
CREATE OR REPLACE FUNCTION public.elo_sync_next_target()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_kind text;
  v_id bigint;
  v_result jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(56099123) THEN
    RETURN jsonb_build_object('status','BUSY');
  END IF;

  SELECT kind,id INTO v_kind,v_id
  FROM (
    SELECT
      'DOMESTIC' AS kind,
      league_id AS id,
      last_synced_at,
      CASE
        WHEN last_sync_status='ERROR'
          AND last_synced_at IS NOT NULL
          AND (last_synced_at AT TIME ZONE 'America/Sao_Paulo')::date =
              (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 3
        WHEN focus_role='CORE' THEN 0
        ELSE 1
      END AS priority
    FROM public.elo_target_leagues
    WHERE active
      AND (
        last_synced_at IS NULL
        OR (last_synced_at AT TIME ZONE 'America/Sao_Paulo')::date <
           (now() AT TIME ZONE 'America/Sao_Paulo')::date
        OR (
          last_sync_status='ERROR'
          AND last_synced_at <= now()-interval '10 minutes'
        )
      )

    UNION ALL

    SELECT
      'CROSS' AS kind,
      competition_id AS id,
      last_synced_at,
      CASE
        WHEN last_sync_status='ERROR'
          AND last_synced_at IS NOT NULL
          AND (last_synced_at AT TIME ZONE 'America/Sao_Paulo')::date =
              (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 3
        ELSE 0
      END AS priority
    FROM public.elo_cross_competitions
    WHERE active
      AND (
        last_synced_at IS NULL
        OR (last_synced_at AT TIME ZONE 'America/Sao_Paulo')::date <
           (now() AT TIME ZONE 'America/Sao_Paulo')::date
        OR (
          last_sync_status='ERROR'
          AND last_synced_at <= now()-interval '10 minutes'
        )
      )
  ) q
  ORDER BY priority,last_synced_at NULLS FIRST,id
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('status','ALL_CURRENT');
  END IF;

  IF v_kind='DOMESTIC' THEN
    v_result := public.elo_sync_domestic_league(v_id);
  ELSE
    v_result := public.elo_sync_cross_competition(v_id);
  END IF;

  RETURN jsonb_build_object('kind',v_kind,'id',v_id,'result',v_result);
END
$function$;

-- Expand the audit to cover team-ledger integrity, complete CORE coverage and
-- the exact hierarchy rules used by the model.
CREATE OR REPLACE FUNCTION public.elo_run_audit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s jsonb;
  i jsonb;
  st text;
  rid uuid;
  ta record;
  v_min_big5 numeric;
  v_max_div2 numeric;
  v_max_core_div2 numeric;
  v_max_mean_drift numeric;
  v_min_parent_gap numeric;
  v_core_targets integer;
  v_core_loaded integer;
  v_team_issues integer;
BEGIN
  SELECT min(rating) INTO v_min_big5
  FROM public.elo_league_ratings
  WHERE model_version='league-elo-v1'
    AND league_key IN (
      'england-premier-league','spain-la-liga','germany-bundesliga',
      'italy-serie-a','france-ligue-1'
    );

  SELECT max(rating) INTO v_max_div2
  FROM public.elo_league_ratings
  WHERE model_version='league-elo-v1' AND division_level>=2;

  SELECT max(rating) INTO v_max_core_div2
  FROM public.elo_league_ratings
  WHERE model_version='league-elo-v1' AND division_level>=2 AND focus_role='CORE';

  SELECT max(local_mean_drift) INTO v_max_mean_drift
  FROM public.elo_audit_leagues;

  SELECT min(parent_league_rating-league_rating) INTO v_min_parent_gap
  FROM public.elo_audit_leagues
  WHERE parent_league_key IS NOT NULL;

  SELECT count(*) INTO v_core_targets
  FROM public.elo_target_leagues
  WHERE active AND focus_role='CORE';

  SELECT count(*) INTO v_core_loaded
  FROM public.elo_audit_leagues
  WHERE focus_role='CORE' AND teams>0 AND last_sync_status='OK' AND league_rating IS NOT NULL;

  SELECT * INTO ta FROM public.elo_team_integrity_audit;
  v_team_issues :=
    coalesce(ta.zero_match_rows,0)+
    coalesce(ta.missing_history_rows,0)+
    coalesce(ta.match_count_mismatch_rows,0)+
    coalesce(ta.first_fixture_mismatch_rows,0)+
    coalesce(ta.last_fixture_mismatch_rows,0)+
    coalesce(ta.rating_mismatch_rows,0)+
    coalesce(ta.orphan_target_rows,0)+
    coalesce(ta.metadata_mismatch_rows,0);

  SELECT jsonb_build_object(
    'targetLeagues',count(*),
    'coreTargetLeagues',v_core_targets,
    'coreLoadedLeagues',v_core_loaded,
    'leaguesWithTeamElo',count(*) FILTER(WHERE teams>0),
    'teams',coalesce(sum(teams),0),
    'teamIntegrityIssues',v_team_issues,
    'teamIntegrity',to_jsonb(ta),
    'leagueRatings',count(*) FILTER(WHERE league_rating IS NOT NULL),
    'hierarchyViolations',count(*) FILTER(WHERE hierarchy_ok=false),
    'minParentDivisionGap',v_min_parent_gap,
    'requiredParentDivisionGap',70,
    'minBig5LeagueRating',v_min_big5,
    'maxSecondDivisionRating',v_max_div2,
    'maxCoreSecondDivisionRating',v_max_core_div2,
    'coreSecondDivisionsBelowBig5By25',coalesce(v_max_core_div2<=v_min_big5-25,true),
    'maxLocalMeanDrift',v_max_mean_drift,
    'localMeanDriftTolerance',25,
    'syncErrors',count(*) FILTER(WHERE last_sync_status='ERROR'),
    'auditIssues',count(*) FILTER(WHERE audit_status<>'OK'),
    'crossTargets',(SELECT count(*) FROM public.elo_cross_competitions WHERE active),
    'crossSyncErrors',(
      SELECT count(*) FROM public.elo_cross_competitions
      WHERE active AND last_sync_status='ERROR'
    ),
    'crossFixturesStored',(SELECT count(*) FROM public.elo_cross_fixtures),
    'crossFixturesUsed',(
      SELECT count(*) FROM public.elo_league_fixture_history
      WHERE model_version='league-elo-v1'
    ),
    'latestTeamFixture',max(last_fixture_at)
  ) INTO s
  FROM public.elo_audit_leagues;

  SELECT coalesce(
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
    )) FILTER(WHERE audit_status<>'OK'),
    '[]'::jsonb
  ) INTO i
  FROM public.elo_audit_leagues;

  IF v_team_issues>0 THEN
    i := i || jsonb_build_array(jsonb_build_object(
      'status','TEAM_LEDGER_INTEGRITY',
      'details',to_jsonb(ta)
    ));
  END IF;

  IF v_core_loaded<>v_core_targets THEN
    i := i || jsonb_build_array(jsonb_build_object(
      'status','CORE_COVERAGE_INCOMPLETE',
      'coreTargets',v_core_targets,
      'coreLoaded',v_core_loaded
    ));
  END IF;

  IF v_min_parent_gap IS NOT NULL AND v_min_parent_gap<70 THEN
    i := i || jsonb_build_array(jsonb_build_object(
      'status','PARENT_DIVISION_GAP_VIOLATION',
      'minimumGap',v_min_parent_gap,
      'requiredGap',70
    ));
  END IF;

  IF v_min_big5 IS NOT NULL AND v_max_core_div2 IS NOT NULL
     AND v_max_core_div2>v_min_big5-25 THEN
    i := i || jsonb_build_array(jsonb_build_object(
      'status','CORE_SECOND_DIVISION_BIG5_GAP_VIOLATION',
      'big5Floor',v_min_big5,
      'maxCoreSecondDivision',v_max_core_div2,
      'requiredGap',25
    ));
  END IF;

  st := CASE
    WHEN jsonb_array_length(i)=0
      AND (SELECT count(*) FROM public.elo_cross_competitions WHERE active AND last_sync_status='ERROR')=0
    THEN 'OK'
    ELSE 'ATTENTION'
  END;

  INSERT INTO public.elo_audit_runs(model_version,status,summary,issues)
  VALUES('hierarchical-elo-v1',st,s,i)
  RETURNING id INTO rid;

  RETURN jsonb_build_object('id',rid,'status',st,'summary',s,'issues',i);
END
$function$;

-- Finalization treats same-day ERROR/RUNNING/stale targets as incomplete and
-- propagates audit ATTENTION instead of masking it as OK.
CREATE OR REPLACE FUNCTION public.elo_finalize_daily()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  l jsonb;
  a jsonb;
  pending integer;
  v_domestic_current integer;
  v_cross_current integer;
  v_status text;
BEGIN
  SELECT count(*) INTO pending
  FROM (
    SELECT league_id
    FROM public.elo_target_leagues
    WHERE active
      AND (
        last_synced_at IS NULL
        OR (last_synced_at AT TIME ZONE 'America/Sao_Paulo')::date <
           (now() AT TIME ZONE 'America/Sao_Paulo')::date
        OR last_sync_status IS DISTINCT FROM 'OK'
      )
    UNION ALL
    SELECT competition_id
    FROM public.elo_cross_competitions
    WHERE active
      AND (
        last_synced_at IS NULL
        OR (last_synced_at AT TIME ZONE 'America/Sao_Paulo')::date <
           (now() AT TIME ZONE 'America/Sao_Paulo')::date
        OR last_sync_status IS DISTINCT FROM 'OK'
      )
  ) p;

  SELECT count(*) INTO v_domestic_current
  FROM public.elo_target_leagues
  WHERE active
    AND last_sync_status='OK'
    AND (last_synced_at AT TIME ZONE 'America/Sao_Paulo')::date =
        (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  SELECT count(*) INTO v_cross_current
  FROM public.elo_cross_competitions
  WHERE active
    AND last_sync_status='OK'
    AND (last_synced_at AT TIME ZONE 'America/Sao_Paulo')::date =
        (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  l := public.elo_rebuild_league_ratings();
  a := public.elo_run_audit();

  v_status := CASE
    WHEN pending>0 THEN 'PARTIAL'
    WHEN a->>'status' <> 'OK' THEN 'ATTENTION'
    ELSE 'OK'
  END;

  UPDATE public.elo_sync_state
  SET model_version='hierarchical-elo-v1',
      last_completed_at=now(),
      last_status=v_status,
      leagues_processed=v_domestic_current,
      fixtures_fetched=(SELECT count(*) FROM public.elo_fixtures),
      api_requests=0,
      error_message=CASE
        WHEN pending>0 THEN pending||' alvo(s) pendente(s) ou com erro'
        WHEN a->>'status'<>'OK' THEN 'Auditoria Elo requer atenção'
        ELSE NULL
      END,
      details=jsonb_build_object(
        'pendingTargets',pending,
        'domesticCurrent',v_domestic_current,
        'domesticTargets',(SELECT count(*) FROM public.elo_target_leagues WHERE active),
        'crossCurrent',v_cross_current,
        'crossTargets',(SELECT count(*) FROM public.elo_cross_competitions WHERE active),
        'leagueRatings',l,
        'audit',a
      ),
      updated_at=now()
  WHERE id='main';

  RETURN jsonb_build_object(
    'status',v_status,
    'pendingTargets',pending,
    'domesticCurrent',v_domestic_current,
    'crossCurrent',v_cross_current,
    'leagueRatings',l,
    'audit',a
  );
END
$function$;
