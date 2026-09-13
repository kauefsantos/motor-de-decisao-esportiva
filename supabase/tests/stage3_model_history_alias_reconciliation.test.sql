begin;
select plan(4);

insert into private.five_dollar_model_matches(
  fixture_id,external_match_id,fixture_date,home_team_id,away_team_id,
  home_goals,away_goals,home_corners,away_corners,
  first_observed_at,last_observed_at,has_conflict
) values(
  9000000002,'brazil-serie:2026-01-03:home-away','2026-01-03',301,302,
  1,0,5,2,'2026-01-03 20:00:00+00','2026-01-03 20:00:00+00',false
);

select lives_ok(
  $$select private.merge_five_dollar_model_match(
    9000000002,'brazil-serie-a:2026-01-03:home-away','2026-01-03',301,302,
    1,0,5,2,null,null,null,null,
    '2026-01-03 20:00:00+00','2026-01-04 10:00:00+00',false
  )$$,
  'textual league alias drift for the same provider fixture remains mergeable'
);

select is(
  (select has_conflict from private.five_dollar_model_matches where fixture_id=9000000002),
  false,
  'externalMatchId alias drift alone does not mark canonical fixture as conflicting'
);

select is(
  (select external_match_id from private.five_dollar_model_matches where fixture_id=9000000002),
  'brazil-serie-a:2026-01-03:home-away',
  'newer resolved lineage may replace an older generic textual alias'
);

select ok(
  position('count(distinct r.raw_value->>''externalMatchId'')' in pg_get_functiondef('public.backfill_five_dollar_model_history_window(timestamptz,timestamptz)'::regprocedure))=0
  and exists(select 1 from public.app_schema_releases where version='20260913-stage3-model-history-alias-reconciliation'),
  'bounded backfill no longer treats externalMatchId alias count as a hard conflict'
);

select * from finish();
rollback;
