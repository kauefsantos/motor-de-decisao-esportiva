begin;

select plan(8);

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
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ),
  'browser roles cannot execute SECURITY DEFINER functions'
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

select * from finish();

rollback;
