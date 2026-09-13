begin;
select plan(10);

select ok(
  to_regclass('private.five_dollar_model_matches') is not null,
  'canonical FiveDollar model-history table exists in private schema'
);

select ok(
  to_regclass('public.idx_raw_observations_model_history_latest') is null,
  'expression-leading raw history index is removed'
);

select ok(
  exists(
    select 1 from pg_indexes
    where schemaname='public' and tablename='raw_observations'
      and indexname='idx_raw_observations_model_history_filter'
  ),
  'bounded backfill has a metric + observed_at filter index'
);

select ok(
  exists(
    select 1 from pg_trigger
    where tgrelid='public.raw_observations'::regclass
      and tgname='trg_capture_five_dollar_model_history'
      and not tgisinternal
  ),
  'future FiveDollar observations maintain canonical model history automatically'
);

select ok(
  position('62 days' in pg_get_functiondef('public.backfill_five_dollar_model_history_window(timestamptz,timestamptz)'::regprocedure))>0,
  'historical backfill is bounded to short windows'
);

select ok(
  has_function_privilege('service_role','public.backfill_five_dollar_model_history_window(timestamptz,timestamptz)','EXECUTE')
  and not has_function_privilege('authenticated','public.backfill_five_dollar_model_history_window(timestamptz,timestamptz)','EXECUTE')
  and not has_function_privilege('anon','public.backfill_five_dollar_model_history_window(timestamptz,timestamptz)','EXECUTE'),
  'backfill helper remains server-only'
);

select ok(
  position('private.five_dollar_model_matches' in pg_get_functiondef('public.get_five_dollar_model_history_rows(timestamptz,integer)'::regprocedure))>0
  and position('public.raw_observations' in pg_get_functiondef('public.get_five_dollar_model_history_rows(timestamptz,integer)'::regprocedure))=0,
  'inference RPC reads compact canonical history instead of raw observations'
);

select ok(
  position('h.first_observed_at < p_prediction_at' in pg_get_functiondef('public.get_five_dollar_model_history_rows(timestamptz,integer)'::regprocedure))>0,
  'canonical model history keeps strict point-in-time cutoff'
);

select ok(
  position('h.has_conflict = false' in lower(pg_get_functiondef('public.get_five_dollar_model_history_rows(timestamptz,integer)'::regprocedure)))>0,
  'conflicting historical fixtures fail closed out of inference'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260913-stage3-model-history-materialized'),
  'materialized Stage 3 model-history release is registered'
);

select * from finish();
rollback;
