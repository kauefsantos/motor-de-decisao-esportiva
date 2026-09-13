begin;
select plan(20);

select has_column(
  'private','model_validation_jobs','target_calibration_version',
  'validation jobs bind the exact calibration artifact as part of job identity'
);

select ok(
  exists(select 1 from public.model_versions where market_family='1X2' and model_version='goals-baseline-v2-recency' and calibration_version is null and validation_status='NOT_PRODUCTION_VALIDATED'),
  'current domestic 1X2 GOALS baseline is registered without promotion'
);

select ok(
  exists(select 1 from public.model_versions where market_family='1X2' and model_version='goals-baseline-v2-recency+elo-v1-w020' and calibration_version is null and validation_status='NOT_PRODUCTION_VALIDATED'),
  'current domestic 1X2 GOALS Elo artifact is independently registered without promotion'
);

select ok(
  exists(select 1 from public.model_versions where market_family='BTTS' and model_version='goals-baseline-v2-recency' and calibration_version is null and validation_status='NOT_PRODUCTION_VALIDATED'),
  'current domestic BTTS GOALS baseline is independently registered without promotion'
);

select ok(
  exists(select 1 from public.model_versions where market_family='1X2' and model_version='goals-baseline-v2-recency+cross-league-domestic-v1' and calibration_version is null),
  'cross-league GOALS is inventoried as a distinct artifact'
);

select ok(
  exists(select 1 from public.model_versions where market_family in ('1X2','BTTS') and model_version='goals-bivariate-v0'),
  'legacy GOALS registry truth is preserved instead of rewritten'
);

select ok(
  has_function_privilege('service_role','public.get_model_artifact_inventory()','EXECUTE')
  and not has_function_privilege('authenticated','public.get_model_artifact_inventory()','EXECUTE')
  and not has_function_privilege('anon','public.get_model_artifact_inventory()','EXECUTE'),
  'runtime artifact inventory is server-only'
);

select ok(
  has_function_privilege('service_role','public.get_stage6_goals_validation_rows_page(date,bigint,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_stage6_goals_validation_rows_page(date,bigint,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_stage6_goals_validation_rows_page(date,bigint,integer)','EXECUTE'),
  'GOALS canonical validation dataset is server-only'
);

select ok(
  position('private.five_dollar_model_matches' in pg_get_functiondef('public.get_stage6_goals_validation_rows_page(date,bigint,integer)'::regprocedure))>0
  and position('has_conflict=false' in regexp_replace(lower(pg_get_functiondef('public.get_stage6_goals_validation_rows_page(date,bigint,integer)'::regprocedure)), '\s+', '', 'g'))>0,
  'GOALS validation dataset uses canonical fixtures and fails closed on conflicts'
);

select ok(
  position('public.elo_fixture_history' in pg_get_functiondef('public.get_stage6_goals_validation_rows_page(date,bigint,integer)'::regprocedure))>0
  and position('public.elo_team_ratings' in pg_get_functiondef('public.get_stage6_goals_validation_rows_page(date,bigint,integer)'::regprocedure))=0,
  'GOALS Elo validation uses fixture point-in-time before-ratings and never current ratings'
);

select ok(
  has_function_privilege('service_role','public.claim_model_validation(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_model_validation(uuid,uuid)','EXECUTE'),
  'generic validation claim is server-only'
);

select ok(
  has_function_privilege('service_role','public.complete_model_validation(uuid,uuid,jsonb,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.complete_model_validation(uuid,uuid,jsonb,text)','EXECUTE'),
  'generic validation completion is server-only'
);

select ok(
  position('set validation_status' in lower(pg_get_functiondef('public.complete_model_validation(uuid,uuid,jsonb,text)'::regprocedure)))=0,
  'validation completion cannot promote validation_status'
);

select ok(
  position('calibration_version is not distinct from v_calibration' in lower(pg_get_functiondef('public.complete_model_validation(uuid,uuid,jsonb,text)'::regprocedure)))>0,
  'validation report is bound to the exact calibration artifact and cannot silently swap it'
);

select ok(
  has_function_privilege('service_role','public.kick_stage6_goals_validation(text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.kick_stage6_goals_validation(text,text)','EXECUTE')
  and not has_function_privilege('anon','public.kick_stage6_goals_validation(text,text)','EXECUTE'),
  'Stage 6 GOALS dispatcher is server-only'
);

select ok(
  exists(select 1 from public.model_versions where market_family='CORNERS' and model_version='corners-negbin-v2+nb2' and validation_status='NOT_PRODUCTION_VALIDATED' and calibration_version is null),
  'failed Stage 4 NB2 challenger remains blocked and immutable'
);

select ok(
  not exists(select 1 from public.model_versions where market_family='CARDS' and validation_status='PRODUCTION_VALIDATED'),
  'CARDS remain blocked pending settlement-definition compatibility'
);

select ok(
  position('x.model_probability<0.70' in regexp_replace(lower(pg_get_functiondef('public.replace_decision_queue_atomic(uuid,uuid,jsonb)'::regprocedure)), '\s+', '', 'g'))>0
  and position('x.entry_odd<1.70' in regexp_replace(lower(pg_get_functiondef('public.replace_decision_queue_atomic(uuid,uuid,jsonb)'::regprocedure)), '\s+', '', 'g'))>0
  and position('x.edge<0.05' in regexp_replace(lower(pg_get_functiondef('public.replace_decision_queue_atomic(uuid,uuid,jsonb)'::regprocedure)), '\s+', '', 'g'))>0
  and position('x.expected_value<0.08' in regexp_replace(lower(pg_get_functiondef('public.replace_decision_queue_atomic(uuid,uuid,jsonb)'::regprocedure)), '\s+', '', 'g'))>0,
  'Stage 5 probability, odd, edge and EV gates are unchanged'
);

select ok(
  position('return0;' in regexp_replace(lower(pg_get_functiondef('public.replace_decision_queue_atomic(uuid,uuid,jsonb)'::regprocedure)), '\s+', '', 'g'))>0
  and position('mp.calibration_versionisnull' in regexp_replace(lower(pg_get_functiondef('public.replace_decision_queue_atomic(uuid,uuid,jsonb)'::regprocedure)), '\s+', '', 'g'))>0,
  'zero bets remains valid and uncalibrated models remain non-executable'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260913-stage6-model-portfolio-validation'),
  'Stage 6 model portfolio validation release is registered'
);

select * from finish();
rollback;
