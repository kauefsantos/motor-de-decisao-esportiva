do $$
declare
  v_legacy_trigger integer;
  v_legacy_function integer;
  v_canonical_trigger integer;
begin
  select count(*) into v_legacy_trigger
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid=t.tgrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname='experimental_bet_tracking'
    and t.tgname='experimental_selection_limit_guard'
    and not t.tgisinternal;

  if v_legacy_trigger <> 0 then
    raise exception 'legacy weekday/weekend selection trigger is still active';
  end if;

  select count(*) into v_legacy_function
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private'
    and p.proname='experimental_selection_limit_guard';

  if v_legacy_function <> 0 then
    raise exception 'legacy weekday/weekend selection function still exists';
  end if;

  select count(*) into v_canonical_trigger
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid=t.tgrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname='experimental_bet_tracking'
    and t.tgname='trg_experimental_selection_limit'
    and t.tgenabled <> 'D'
    and not t.tgisinternal;

  if v_canonical_trigger <> 1 then
    raise exception 'canonical fixed max-3 selection trigger is missing or disabled';
  end if;
end;
$$;
