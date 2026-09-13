begin;
select plan(8);

select ok(
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='experimental_bet_tracking' and column_name='decision_odd')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='experimental_bet_tracking' and column_name='decision_expected_value')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='experimental_bet_tracking' and column_name='decision_edge')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='experimental_bet_tracking' and column_name='execution_quote_captured_at')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='experimental_bet_tracking' and column_name='execution_quote_source'),
  'decision quote and execution quote have separate audit fields'
);

select ok(
  to_regprocedure('public.confirm_experimental_bet_atomic(uuid,numeric)') is null,
  'legacy confirmation RPC that reused decision-time odds no longer exists'
);

select ok(
  to_regprocedure('public.confirm_experimental_bet_atomic(uuid,numeric,numeric,numeric,numeric,numeric)') is not null,
  'confirmation RPC requires execution odd, EV, edge and line'
);

select ok(
  has_function_privilege('service_role','public.confirm_experimental_bet_atomic(uuid,numeric,numeric,numeric,numeric,numeric)','EXECUTE')
  and not has_function_privilege('authenticated','public.confirm_experimental_bet_atomic(uuid,numeric,numeric,numeric,numeric,numeric)','EXECUTE')
  and not has_function_privilege('anon','public.confirm_experimental_bet_atomic(uuid,numeric,numeric,numeric,numeric,numeric)','EXECUTE'),
  'execution quote confirmation RPC is server-only'
);

select ok(
  position('p_entry_odd<1.70' in regexp_replace(pg_get_functiondef('public.confirm_experimental_bet_atomic(uuid,numeric,numeric,numeric,numeric,numeric)'::regprocedure),'\s+','','g')) > 0
  and position('p_expected_value<0.08' in regexp_replace(pg_get_functiondef('public.confirm_experimental_bet_atomic(uuid,numeric,numeric,numeric,numeric,numeric)'::regprocedure),'\s+','','g')) > 0
  and position('p_edge<0.05' in regexp_replace(pg_get_functiondef('public.confirm_experimental_bet_atomic(uuid,numeric,numeric,numeric,numeric,numeric)'::regprocedure),'\s+','','g')) > 0,
  'positive stake is protected by the 1.70 / EV 8% / edge 5pp execution quote gates'
);

select ok(
  position('p_line_canonicalisdistinctfromv_tracking.line_canonical' in lower(regexp_replace(pg_get_functiondef('public.confirm_experimental_bet_atomic(uuid,numeric,numeric,numeric,numeric,numeric)'::regprocedure),'\s+','','g'))) > 0,
  'execution quote must preserve the modelled line'
);

select ok(
  position('decision_odd=coalesce(t.decision_odd,t.entry_odd)' in regexp_replace(pg_get_functiondef('public.confirm_experimental_bet_atomic(uuid,numeric,numeric,numeric,numeric,numeric)'::regprocedure),'\s+','','g')) > 0
  and position('entry_odd=p_entry_odd' in regexp_replace(pg_get_functiondef('public.confirm_experimental_bet_atomic(uuid,numeric,numeric,numeric,numeric,numeric)'::regprocedure),'\s+','','g')) > 0
  and position('execution_quote_source=''USER_CONFIRMED_BET365''' in regexp_replace(pg_get_functiondef('public.confirm_experimental_bet_atomic(uuid,numeric,numeric,numeric,numeric,numeric)'::regprocedure),'\s+','','g')) > 0,
  'decision price is preserved while entry_odd becomes the actual executed price'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260913-stage5-execution-quote-revalidation'),
  'Stage 5 execution quote release is registered'
);

select * from finish();
rollback;
