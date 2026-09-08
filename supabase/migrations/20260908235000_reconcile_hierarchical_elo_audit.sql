-- Reconcile the repository with the hierarchical Elo audit definition already
-- running in the canonical Supabase database.
--
-- This is intentionally additive/idempotent. Do not replay the original
-- 20260908230000 migration just to repair migration metadata: the live schema
-- already contains the hierarchical Elo tables, functions and data.

DROP VIEW IF EXISTS public.elo_audit_leagues;
CREATE VIEW public.elo_audit_leagues AS
SELECT
  cfg.league_id,
  cfg.league_key,
  cfg.league_name,
  cfg.country_code,
  cfg.region,
  cfg.division_level,
  cfg.focus_role,
  cfg.prior_rating,
  cfg.parent_league_key,
  cfg.last_synced_at,
  cfg.last_sync_status,
  cfg.last_sync_error,
  count(t.team_id)::integer AS teams,
  avg(t.rating) AS local_avg_rating,
  abs(coalesce(avg(t.rating), 1500::numeric) - 1500::numeric) AS local_mean_drift,
  min(t.rating) AS local_min_rating,
  max(t.rating) AS local_max_rating,
  max(t.last_fixture_at) AS last_fixture_at,
  lr.rating AS league_rating,
  lr.evidence_adjustment,
  lr.evidence_matches,
  lr.hierarchy_constrained,
  parent.rating AS parent_league_rating,
  CASE
    WHEN cfg.parent_league_key IS NULL THEN true
    ELSE lr.rating <= parent.rating - 70::numeric
  END AS hierarchy_ok,
  CASE
    WHEN cfg.last_sync_status = 'ERROR' THEN 'SYNC_ERROR'
    WHEN count(t.team_id) = 0 THEN 'NO_TEAM_ELO'
    -- Team Elo is league-local and need not have an exact arithmetic mean of
    -- 1500 after an incomplete/uneven fixture set. The live audited tolerance
    -- is 25 Elo points; observed maximum drift is currently well inside it.
    WHEN abs(coalesce(avg(t.rating), 1500::numeric) - 1500::numeric) > 25::numeric THEN 'LOCAL_MEAN_DRIFT'
    WHEN min(t.rating) < 1200::numeric OR max(t.rating) > 1850::numeric THEN 'TEAM_RANGE_OUTLIER'
    WHEN cfg.parent_league_key IS NOT NULL AND NOT (lr.rating <= parent.rating - 70::numeric) THEN 'HIERARCHY_VIOLATION'
    ELSE 'OK'
  END AS audit_status
FROM public.elo_target_leagues cfg
LEFT JOIN public.elo_team_ratings t
  ON t.model_version = 'elo-v1-w020' AND t.league_id = cfg.league_id
LEFT JOIN public.elo_league_ratings lr
  ON lr.model_version = 'league-elo-v1' AND lr.league_id = cfg.league_id
LEFT JOIN public.elo_league_ratings parent
  ON parent.model_version = 'league-elo-v1' AND parent.league_key = cfg.parent_league_key
WHERE cfg.active
GROUP BY
  cfg.league_id,
  cfg.league_key,
  cfg.league_name,
  cfg.country_code,
  cfg.region,
  cfg.division_level,
  cfg.focus_role,
  cfg.prior_rating,
  cfg.parent_league_key,
  cfg.last_synced_at,
  cfg.last_sync_status,
  cfg.last_sync_error,
  lr.rating,
  lr.evidence_adjustment,
  lr.evidence_matches,
  lr.hierarchy_constrained,
  parent.rating;

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
  v_min_big5 numeric;
  v_max_div2 numeric;
  v_max_mean_drift numeric;
BEGIN
  SELECT min(rating)
  INTO v_min_big5
  FROM public.elo_league_ratings
  WHERE model_version = 'league-elo-v1'
    AND league_key IN (
      'england-premier-league',
      'spain-la-liga',
      'germany-bundesliga',
      'italy-serie-a',
      'france-ligue-1'
    );

  SELECT max(rating)
  INTO v_max_div2
  FROM public.elo_league_ratings
  WHERE model_version = 'league-elo-v1'
    AND division_level >= 2;

  SELECT max(local_mean_drift)
  INTO v_max_mean_drift
  FROM public.elo_audit_leagues;

  SELECT jsonb_build_object(
    'targetLeagues', count(*),
    'leaguesWithTeamElo', count(*) FILTER (WHERE teams > 0),
    'teams', coalesce(sum(teams), 0),
    'leagueRatings', count(*) FILTER (WHERE league_rating IS NOT NULL),
    'hierarchyViolations', count(*) FILTER (WHERE hierarchy_ok = false),
    'minBig5LeagueRating', v_min_big5,
    'maxSecondDivisionRating', v_max_div2,
    'secondDivisionsBelowBig5', coalesce(v_max_div2 < v_min_big5, true),
    'maxLocalMeanDrift', v_max_mean_drift,
    'localMeanDriftTolerance', 25,
    'syncErrors', count(*) FILTER (WHERE last_sync_status = 'ERROR'),
    'auditIssues', count(*) FILTER (WHERE audit_status <> 'OK'),
    'crossTargets', (SELECT count(*) FROM public.elo_cross_competitions WHERE active),
    'crossSyncErrors', (
      SELECT count(*)
      FROM public.elo_cross_competitions
      WHERE active AND last_sync_status = 'ERROR'
    ),
    'crossFixturesStored', (SELECT count(*) FROM public.elo_cross_fixtures),
    'crossFixturesUsed', (
      SELECT count(*)
      FROM public.elo_league_fixture_history
      WHERE model_version = 'league-elo-v1'
    ),
    'latestTeamFixture', max(last_fixture_at)
  )
  INTO s
  FROM public.elo_audit_leagues;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'leagueKey', league_key,
        'leagueName', league_name,
        'status', audit_status,
        'syncStatus', last_sync_status,
        'syncError', last_sync_error,
        'teams', teams,
        'localAvg', local_avg_rating,
        'localMeanDrift', local_mean_drift,
        'localMin', local_min_rating,
        'localMax', local_max_rating,
        'leagueRating', league_rating,
        'parent', parent_league_key,
        'parentRating', parent_league_rating,
        'hierarchyOk', hierarchy_ok
      )
    ) FILTER (WHERE audit_status <> 'OK'),
    '[]'::jsonb
  )
  INTO i
  FROM public.elo_audit_leagues;

  st := CASE
    WHEN jsonb_array_length(i) = 0
      AND (SELECT count(*) FROM public.elo_cross_competitions WHERE active AND last_sync_status = 'ERROR') = 0
      AND coalesce(v_max_div2 < v_min_big5, true)
    THEN 'OK'
    ELSE 'ATTENTION'
  END;

  INSERT INTO public.elo_audit_runs(model_version, status, summary, issues)
  VALUES ('hierarchical-elo-v1', st, s, i)
  RETURNING id INTO rid;

  RETURN jsonb_build_object('id', rid, 'status', st, 'summary', s, 'issues', i);
END
$function$;
