begin;
select plan(3);

select ok(
  position('ifv_count=0andnotv_exhaustedthen' in lower(regexp_replace(pg_get_functiondef('public.finalize_decision_selection_atomic(uuid,uuid)'::regprocedure),'\s+','','g'))) > 0,
  'zero finalization remains fail-safe while one or two choices may finalize voluntarily'
);

select ok(
  has_function_privilege('service_role','public.finalize_decision_selection_atomic(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.finalize_decision_selection_atomic(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.finalize_decision_selection_atomic(uuid,uuid)','EXECUTE'),
  'voluntary finalization RPC remains server-only'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260913-stage5-voluntary-finalize-compat'),
  'Stage 5 voluntary finalize compatibility release is registered'
);

select * from finish();
rollback;