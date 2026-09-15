begin;
select plan(9);

select is(
  (select count(*)::integer from pg_policies
   where schemaname='public' and tablename='analysis_drafts'
     and policyname in ('analysis_drafts_owner_select','analysis_drafts_owner_insert','analysis_drafts_owner_update','analysis_drafts_owner_delete')),
  4,
  'analysis_drafts has complete owner-scoped CRUD policies'
);

select is(
  (select count(*)::integer from pg_policies
   where schemaname='public' and tablename='analysis_draft_games'
     and policyname in ('analysis_draft_games_owner_select','analysis_draft_games_owner_insert','analysis_draft_games_owner_update','analysis_draft_games_owner_delete')),
  4,
  'analysis_draft_games has complete inherited-owner CRUD policies'
);

select is(
  (select count(*)::integer from pg_policies
   where schemaname='public' and tablename='decision_opportunity_queue'
     and policyname in ('run_owner_select','run_owner_insert','run_owner_update','run_owner_delete')),
  4,
  'decision opportunity queue has run-owner CRUD policies'
);

select is(
  (select count(*)::integer from pg_policies
   where schemaname='public' and tablename='push_delivery_outbox'
     and policyname='push_delivery_outbox_select_own'),
  1,
  'push delivery outbox exposes only the explicit owner-scoped read policy'
);

select is(
  (select count(*)::integer
   from pg_class c
   join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public'
     and c.relname in ('analysis_drafts','analysis_draft_games','decision_opportunity_queue','push_delivery_outbox')
     and c.relrowsecurity),
  4,
  'all hardened public tables keep RLS enabled'
);

select is(
  (select count(*)::integer
   from pg_proc p
   join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('elo_is_target_league','elo_league_key','normalize_brazil_league_lineage','normalize_prediction_outcome_distribution')
     and coalesce(p.proconfig,'{}'::text[]) @> array['search_path=""']::text[]),
  4,
  'all selected application functions use an immutable empty search_path'
);

select ok(
  not has_function_privilege('anon','public.is_approved_app_user()','EXECUTE'),
  'anon cannot execute the approved-user authorization gate'
);

select ok(
  has_function_privilege('authenticated','public.is_approved_app_user()','EXECUTE'),
  'authenticated can execute the approved-user gate required by server auth middleware'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema='public'
      and g.table_name in ('analysis_drafts','analysis_draft_games','decision_opportunity_queue','push_delivery_outbox')
      and g.grantee in ('anon','authenticated')
  ),
  'hardened tables remain unavailable through direct browser table grants'
);

select * from finish();
rollback;
