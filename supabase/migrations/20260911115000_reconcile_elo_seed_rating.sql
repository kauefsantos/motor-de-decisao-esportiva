-- Reconcile the versioned migration chain with the canonical Lovable Cloud Elo runtime.
--
-- Promotion/relegation continuity has been live and audited in production, and later
-- migrations already call public.elo_seed_rating() from public.elo_rebuild_league().
-- The original function definition remained only on an old unmerged development
-- branch, so a fresh database built from main could lack that dependency.
--
-- This migration is intentionally idempotent and reproduces the current live
-- function without changing its business logic or migration metadata.

CREATE OR REPLACE FUNCTION public.elo_seed_rating(
  p_team_id bigint,
  p_new_league_id bigint,
  p_before timestamptz
)
RETURNS double precision
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_old_rating double precision;
  v_old_prior double precision;
  v_new_prior double precision;
BEGIN
  SELECT cfg.prior_rating::double precision
  INTO v_new_prior
  FROM public.elo_target_leagues cfg
  WHERE cfg.league_id = p_new_league_id
    AND cfg.active;

  IF v_new_prior IS NULL THEN
    RETURN 1500;
  END IF;

  SELECT
    CASE
      WHEN h.home_team_id = p_team_id THEN h.home_rating_after::double precision
      ELSE h.away_rating_after::double precision
    END,
    old_cfg.prior_rating::double precision
  INTO v_old_rating, v_old_prior
  FROM public.elo_fixture_history h
  JOIN public.elo_target_leagues old_cfg
    ON old_cfg.league_id = h.league_id
   AND old_cfg.active
  JOIN public.elo_target_leagues new_cfg
    ON new_cfg.league_id = p_new_league_id
   AND new_cfg.active
  WHERE h.model_version = 'elo-v1-w020'
    AND h.league_id <> p_new_league_id
    AND h.kickoff_at < p_before
    AND old_cfg.country_code = new_cfg.country_code
    AND (h.home_team_id = p_team_id OR h.away_team_id = p_team_id)
  ORDER BY h.kickoff_at DESC, h.fixture_id DESC
  LIMIT 1;

  IF v_old_rating IS NULL OR v_old_prior IS NULL THEN
    RETURN 1500;
  END IF;

  RETURN greatest(
    1350.0,
    least(1650.0, v_old_rating + v_old_prior - v_new_prior)
  );
END
$function$;

REVOKE EXECUTE ON FUNCTION public.elo_seed_rating(bigint, bigint, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.elo_seed_rating(bigint, bigint, timestamptz)
  TO service_role;
