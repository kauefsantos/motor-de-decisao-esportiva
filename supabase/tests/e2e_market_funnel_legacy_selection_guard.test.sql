begin;
select plan(3);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid=t.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='experimental_bet_tracking'
      and t.tgname='experimental_selection_limit_guard'
      and not t.tgisinternal
  ),
  0,
  'legacy weekday/weekend selection trigger is absent'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private'
      and p.proname='experimental_selection_limit_guard'
  ),
  0,
  'legacy weekday/weekend selection function is absent'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid=t.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='experimental_bet_tracking'
      and t.tgname='trg_experimental_selection_limit'
      and t.tgenabled <> 'D'
      and not t.tgisinternal
  ),
  1,
  'canonical fixed max-3 selection trigger exists and is enabled'
);

select * from finish();
rollback;
