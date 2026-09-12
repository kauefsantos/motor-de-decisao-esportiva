begin;

select plan(15);

select ok(
  to_regclass('public.app_schema_releases') is not null,
  'application schema release ledger exists'
);

select ok(
  exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='app_schema_releases' and c.relrowsecurity
  ),
  'schema ledger has RLS enabled'
);

select ok(
  not has_table_privilege('anon','public.app_schema_releases','SELECT')
  and not has_table_privilege('authenticated','public.app_schema_releases','SELECT'),
  'browser roles cannot read schema ledger directly'
);

select is(
  (select is_nullable from information_schema.columns
   where table_schema='public' and table_name='raw_observations' and column_name='observation_key'),
  'NO',
  'raw observation identity is mandatory'
);

select ok(
  exists (select 1 from pg_indexes where schemaname='public' and indexname='uq_raw_observations_run_observation_key'),
  'raw observation identity has a unique run-scoped index'
);

select ok(
  exists (select 1 from pg_trigger where tgname='trg_ignore_duplicate_raw_observation' and not tgisinternal),
  'raw observation duplicate guard trigger exists'
);

select ok(
  not exists (
    select 1 from public.raw_observations
    group by run_id, observation_key
    having count(*) > 1
  ),
  'raw observations contain no duplicate identities'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conname='match_external_ids_match_source_key'
      and contype='u'
  ),
  'match external ids are unique by match and source'
);

select ok(
  not exists (
    select 1 from public.match_external_ids
    group by match_id, source
    having count(*) > 1
  ),
  'match external ids contain no duplicate match/source rows'
);

select ok(
  exists (
    select 1 from public.source_definitions
    where source='five_dollar_football'
      and definition_version='five-dollar-v1'
  ),
  '5Dollar source definition is registered'
);

select ok(
  (select count(*) from pg_constraint where conname in (
    'market_candidates_run_match_fkey',
    'model_predictions_run_match_fkey',
    'raw_observations_run_match_fkey',
    'normalized_match_stats_run_match_fkey',
    'source_fetches_run_match_fkey',
    'elo_prediction_context_run_match_fkey',
    'user_odds_run_candidate_fkey',
    'value_evaluations_run_candidate_fkey',
    'final_selections_run_evaluation_fkey',
    'experimental_bet_tracking_run_match_fkey',
    'experimental_odds_snapshots_run_match_fkey'
  )) = 11,
  'all cross-run composite foreign keys exist'
);

select ok(
  exists (select 1 from pg_trigger where tgname='trg_experimental_eval_match_run' and not tgisinternal),
  'experimental evaluations enforce run/match consistency'
);

select ok(
  (select count(*) from pg_constraint where conname in (
    'analysis_runs_nonnegative_counts_check',
    'matches_resolver_confidence_check',
    'model_predictions_probability_range_check',
    'market_candidates_probability_range_check',
    'user_odds_odd_check',
    'value_evaluations_odd_check',
    'value_evaluations_probability_check',
    'final_selections_rank_check',
    'uploaded_files_counts_check',
    'normalized_match_stats_sample_size_check',
    'source_fetches_attempt_check',
    'analysis_jobs_attempts_check',
    'elo_team_ratings_matches_processed_check',
    'elo_league_ratings_evidence_matches_check',
    'elo_cross_fixtures_goals_check',
    'elo_fixture_history_goals_check'
  )) = 16,
  'all defensive integrity checks exist'
);

select is(
  public.raw_observation_identity(
    '11111111-1111-4111-8111-111111111111'::uuid,
    null,
    'test-source',
    'HOME:goals_scored',
    '{"value":1,"fixtureId":"123","teamId":"10"}'::jsonb,
    '2026-09-01T12:00:00Z'::timestamptz,
    'test-v1'
  ),
  public.raw_observation_identity(
    '11111111-1111-4111-8111-111111111111'::uuid,
    null,
    'test-source',
    'HOME:goals_scored',
    '{"teamId":"10","fixtureId":"123","value":1}'::jsonb,
    '2026-09-01T12:00:00Z'::timestamptz,
    'test-v1'
  ),
  'raw observation identity is deterministic across JSON key order'
);

select ok(
  not exists (
    select 1 from public.normalized_match_stats
    group by run_id, match_id, scope, metric
    having count(*) > 1
  ),
  'normalized statistics remain unique by run/match/scope/metric'
);

select * from finish();
rollback;
