begin;
select plan(11);

select ok(
  to_regclass('private.model_validation_jobs') is not null,
  'Stage 4 validation jobs live in the private schema'
);

select ok(
  exists(
    select 1 from public.model_versions
    where market_family='CORNERS'
      and model_version='corners-negbin-v2+nb2'
      and validation_status='NOT_PRODUCTION_VALIDATED'
      and calibration_version is null
  ),
  'exact NB2 runtime artifact is registered without production promotion'
);

select ok(
  exists(
    select 1 from public.model_versions
    where market_family='CORNERS'
      and model_version='corners-negbin-v2+poisson'
      and validation_status='NOT_PRODUCTION_VALIDATED'
      and calibration_version is null
  ),
  'runtime Poisson fallback artifact is explicitly inventoried'
);

select ok(
  has_function_privilege('service_role','public.get_stage4_corners_validation_rows()','EXECUTE')
  and not has_function_privilege('authenticated','public.get_stage4_corners_validation_rows()','EXECUTE')
  and not has_function_privilege('anon','public.get_stage4_corners_validation_rows()','EXECUTE'),
  'canonical validation dataset is server-only'
);

select ok(
  position('private.five_dollar_model_matches' in pg_get_functiondef('public.get_stage4_corners_validation_rows()'::regprocedure))>0
  and position('has_conflict=false' in regexp_replace(lower(pg_get_functiondef('public.get_stage4_corners_validation_rows()'::regprocedure)), '\s+', '', 'g'))>0,
  'Stage 4 dataset reads canonical fixtures and excludes conflicts'
);

select ok(
  has_function_privilege('service_role','public.claim_stage4_model_validation(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_stage4_model_validation(uuid,uuid)','EXECUTE'),
  'validation job claim is server-only'
);

select ok(
  has_function_privilege('service_role','public.complete_stage4_model_validation(uuid,uuid,jsonb,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.complete_stage4_model_validation(uuid,uuid,jsonb,text)','EXECUTE'),
  'validation completion is server-only'
);

select ok(
  has_function_privilege('service_role','public.kick_stage4_corners_validation()','EXECUTE')
  and not has_function_privilege('authenticated','public.kick_stage4_corners_validation()','EXECUTE'),
  'validation dispatcher is server-only'
);

select ok(
  position('validation_status' in lower(pg_get_functiondef('public.complete_stage4_model_validation(uuid,uuid,jsonb,text)'::regprocedure)))=0,
  'validation completion cannot promote model validation status'
);

insert into private.five_dollar_model_matches(
  fixture_id,external_match_id,fixture_date,home_team_id,away_team_id,
  home_corners,away_corners,first_observed_at,last_observed_at,has_conflict
) values
  (9100000001,'stage4-test-league:2020-01-01:home-away','2020-01-01',101,202,6,4,'2020-01-01 20:00:00+00','2020-01-01 20:00:00+00',false),
  (9100000002,'stage4-test-league:2020-01-02:home-away','2020-01-02',101,202,7,5,'2020-01-02 20:00:00+00','2020-01-02 20:00:00+00',true);

select is(
  (select count(*) from public.get_stage4_corners_validation_rows() where fixture_id in (9100000001,9100000002)),
  1::bigint,
  'validation dataset returns valid canonical fixture and fails closed on conflict'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260913-stage4-corners-walk-forward'),
  'Stage 4 walk-forward release is registered'
);

select * from finish();
rollback;
