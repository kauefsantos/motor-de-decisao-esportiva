begin;
select plan(5);

select ok(
  to_regprocedure('public.get_owner_latest_proposed_run_id(uuid)') is not null,
  'owner latest proposed run helper exists'
);

select ok(
  has_function_privilege('service_role','public.get_owner_latest_proposed_run_id(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_owner_latest_proposed_run_id(uuid)','EXECUTE'),
  'owner latest proposed run helper is server-only'
);

select is(
  public.get_owner_latest_proposed_run_id('00000000-0000-0000-0000-000000000000'::uuid),
  null::uuid,
  'unknown owner cannot see another account proposed run'
);

select ok(
  position('r.owner_id=p_owner_id' in pg_get_functiondef('public.get_owner_latest_proposed_run_id(uuid)'::regprocedure)) > 0,
  'helper filters by run owner'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260912-owner-latest-proposed-run'),
  'owner proposed-run release is registered'
);

select * from finish();
rollback;
