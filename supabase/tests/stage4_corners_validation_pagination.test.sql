begin;
select plan(7);

select ok(
  to_regprocedure('public.get_stage4_corners_validation_rows_page(date,bigint,integer)') is not null,
  'Stage 4 paginated validation RPC exists'
);

select ok(
  has_function_privilege('service_role','public.get_stage4_corners_validation_rows_page(date,bigint,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_stage4_corners_validation_rows_page(date,bigint,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_stage4_corners_validation_rows_page(date,bigint,integer)','EXECUTE'),
  'paginated validation dataset is server-only'
);

select ok(
  position('order by m.fixture_date,m.fixture_id' in regexp_replace(lower(pg_get_functiondef('public.get_stage4_corners_validation_rows_page(date,bigint,integer)'::regprocedure)), '\s+', ' ', 'g')) > 0,
  'pagination order is deterministic by fixture date and fixture id'
);

select ok(
  position('m.fixture_id > coalesce(p_after_fixture_id, 0::bigint)' in regexp_replace(lower(pg_get_functiondef('public.get_stage4_corners_validation_rows_page(date,bigint,integer)'::regprocedure)), '\s+', ' ', 'g')) > 0,
  'pagination advances with a keyset instead of offset scanning'
);

insert into private.five_dollar_model_matches(
  fixture_id,external_match_id,fixture_date,home_team_id,away_team_id,
  home_corners,away_corners,first_observed_at,last_observed_at,has_conflict
) values
  (9200000001,'stage4-page-league:1900-01-01:a-b','1900-01-01',101,202,5,4,'1900-01-01 20:00:00+00','1900-01-01 20:00:00+00',false),
  (9200000002,'stage4-page-league:1900-01-01:c-d','1900-01-01',303,404,7,3,'1900-01-01 21:00:00+00','1900-01-01 21:00:00+00',false);

select is(
  (select fixture_id from public.get_stage4_corners_validation_rows_page('1899-12-31',null,1) limit 1),
  9200000001::bigint,
  'first keyset page returns first canonical fixture'
);

select is(
  (select fixture_id from public.get_stage4_corners_validation_rows_page('1900-01-01',9200000001,1) limit 1),
  9200000002::bigint,
  'second keyset page advances within the same date'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260913-stage4-corners-validation-pagination'),
  'Stage 4 pagination release is registered'
);

select * from finish();
rollback;
