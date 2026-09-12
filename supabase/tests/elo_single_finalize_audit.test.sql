begin;
select plan(4);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid=t.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='elo_sync_state'
      and t.tgname='trg_elo_after_sync_rebuild'
      and not t.tgisinternal
  ),
  'redundant Elo post-sync trigger is absent'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='elo_after_sync_rebuild'
  ),
  'redundant Elo post-sync trigger function is absent'
);

select is(
  pg_catalog.regexp_count(
    pg_catalog.pg_get_functiondef('public.elo_finalize_daily()'::pg_catalog.regprocedure),
    'elo_rebuild_league_ratings\(\)'
  ),
  1,
  'daily Elo finalize rebuilds league ratings exactly once'
);

select is(
  pg_catalog.regexp_count(
    pg_catalog.pg_get_functiondef('public.elo_finalize_daily()'::pg_catalog.regprocedure),
    'elo_run_audit\(\)'
  ),
  1,
  'daily Elo finalize runs the audit exactly once'
);

select * from finish();
rollback;
