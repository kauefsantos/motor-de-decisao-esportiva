begin;
select plan(7);

select ok(
  to_regprocedure('public.settle_experimental_bet_atomic(uuid,text)') is not null,
  'financial settlement RPC exists'
);

select ok(
  has_function_privilege('service_role','public.settle_experimental_bet_atomic(uuid,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.settle_experimental_bet_atomic(uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.settle_experimental_bet_atomic(uuid,text)','EXECUTE'),
  'financial settlement RPC is server-only'
);

select ok(
  position('HALF_WIN' in pg_get_functiondef('public.settle_experimental_bet_atomic(uuid,text)'::regprocedure)) > 0
  and position('PUSH' in pg_get_functiondef('public.settle_experimental_bet_atomic(uuid,text)'::regprocedure)) > 0
  and position('HALF_LOSS' in pg_get_functiondef('public.settle_experimental_bet_atomic(uuid,text)'::regprocedure)) > 0
  and position('VOID' in pg_get_functiondef('public.settle_experimental_bet_atomic(uuid,text)'::regprocedure)) > 0,
  'half outcomes, push and void are supported'
);

select ok(
  position('when''HALF_WIN''then(v_odd-1)/2' in lower(regexp_replace(pg_get_functiondef('public.settle_experimental_bet_atomic(uuid,text)'::regprocedure),'\s+','','g'))) > 0
  and position('when''HALF_LOSS''then-0.5' in lower(regexp_replace(pg_get_functiondef('public.settle_experimental_bet_atomic(uuid,text)'::regprocedure),'\s+','','g'))) > 0,
  'half win/loss profit units are financially correct'
);

select ok(
  position('t.entry_odd' in pg_get_functiondef('public.settle_experimental_bet_atomic(uuid,text)'::regprocedure)) > 0
  and position('v_odd-1' in regexp_replace(pg_get_functiondef('public.settle_experimental_bet_atomic(uuid,text)'::regprocedure),'\s+','','g')) > 0,
  'P/L is derived from persisted executed entry odd'
);

select ok(
  position('forupdate' in lower(regexp_replace(pg_get_functiondef('public.settle_experimental_bet_atomic(uuid,text)'::regprocedure),'\s+','','g'))) > 0
  and position("t.bet_status='OPEN'" in regexp_replace(pg_get_functiondef('public.settle_experimental_bet_atomic(uuid,text)'::regprocedure),'\s+','','g')) > 0
  and position("t.result='PENDING'" in regexp_replace(pg_get_functiondef('public.settle_experimental_bet_atomic(uuid,text)'::regprocedure),'\s+','','g')) > 0,
  'settlement stays row-locked and idempotency-safe'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260913-stage5-asian-financial-settlement'),
  'Stage 5 Asian financial settlement release is registered'
);

select * from finish();
rollback;
