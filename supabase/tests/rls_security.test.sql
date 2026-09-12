begin;

select plan(15);

select ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  ),
  'all public tables have RLS enabled'
);

select ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
      and (
        has_table_privilege('anon', c.oid, 'SELECT')
        or has_table_privilege('anon', c.oid, 'INSERT')
        or has_table_privilege('anon', c.oid, 'UPDATE')
        or has_table_privilege('anon', c.oid, 'DELETE')
        or has_table_privilege('authenticated', c.oid, 'SELECT')
        or has_table_privilege('authenticated', c.oid, 'INSERT')
        or has_table_privilege('authenticated', c.oid, 'UPDATE')
        or has_table_privilege('authenticated', c.oid, 'DELETE')
      )
  ),
  'browser roles have no direct privileges on public relations'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'anon cannot execute SECURITY DEFINER functions'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not (
        (n.nspname = 'private' and p.proname in ('is_authorized_app_user', 'owns_run', 'owns_match'))
        or (n.nspname = 'public' and p.proname = 'is_approved_app_user')
      )
  ),
  'authenticated can execute only the whitelisted RLS/auth helper SECURITY DEFINER functions'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and not coalesce('search_path=""' = any(p.proconfig), false)
  ),
  'all application SECURITY DEFINER functions use an empty search_path'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not has_function_privilege('service_role', p.oid, 'EXECUTE')
  ),
  'service_role retains execute permission on public SECURITY DEFINER functions'
);

select ok(
  not exists (
    select 1
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole
      and n.nspname = 'public'
      and (
        a.grantee in ('anon'::regrole, 'authenticated'::regrole)
        or (
          d.defaclobjtype = 'f'
          and a.grantee = 0
          and a.privilege_type = 'EXECUTE'
        )
      )
  ),
  'postgres defaults do not grant browser roles or PUBLIC function execution'
);

select ok(
  exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and n.nspname = 'auth'
      and c.relname = 'users'
      and t.tgname = 'enforce_single_google_user'
  ),
  'auth.users has the single approved Google user trigger'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'enforce_single_google_user'
      and has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
  ),
  'supabase_auth_admin can execute the single-user auth trigger function'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'is_approved_app_user'
      and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'approved-user RPC is authenticated-only and SECURITY DEFINER'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'analysis_runs'
      and column_name = 'owner_id'
      and is_nullable = 'NO'
  ),
  'analysis_runs has a mandatory owner_id'
);

select ok(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'analysis_runs'
      and policyname in (
        'analysis_runs_owner_select', 'analysis_runs_owner_insert',
        'analysis_runs_owner_update', 'analysis_runs_owner_delete'
      )
  ) = 4,
  'analysis_runs has complete owner CRUD policies'
);

select ok(
  not exists (
    select 1
    from unnest(array[
      'elo_prediction_context','experimental_bet_tracking','experimental_odds_snapshots',
      'experimental_value_evaluations','experimental_analysis_results','final_selections',
      'market_candidates','matches','model_predictions','normalized_match_stats','pipeline_logs',
      'raw_observations','source_fetches','uploaded_files','user_odds','value_evaluations'
    ]) as expected(table_name)
    where to_regclass(format('public.%I', expected.table_name)) is not null
      and (
        select count(*) from pg_policies p
        where p.schemaname = 'public'
          and p.tablename = expected.table_name
          and p.policyname in ('run_owner_select','run_owner_insert','run_owner_update','run_owner_delete')
      ) <> 4
  ),
  'every run-scoped relation has complete inherited owner CRUD policies'
);

select ok(
  exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and n.nspname = 'public'
      and c.relname = 'analysis_jobs'
      and t.tgname = 'enforce_analysis_job_owner'
  ),
  'analysis_jobs cannot be attached to a user different from its run owner'
);

select ok(
  exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and n.nspname = 'public'
      and c.relname = 'push_subscriptions'
      and t.tgname = 'prevent_push_endpoint_owner_transfer'
  ),
  'push endpoint ownership cannot be transferred by privileged upsert'
);

select * from finish();

rollback;
