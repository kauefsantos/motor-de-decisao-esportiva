-- RLS defense in depth for the current single-user/private application.
-- Lovable Cloud is the runtime source of truth; this migration is the versioned
-- representation of the same database hardening in GitHub.

-- Existing browser-facing access is deny-by-default. Keep it that way for every
-- existing relation in public. RLS remains enabled independently of these grants.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Harden every application SECURITY DEFINER function that exists at this point
-- in the migration chain. All application object references in these functions
-- are schema-qualified, so an empty search_path removes object-shadowing risk
-- without changing their business logic.
do $$
declare
  fn record;
begin
  for fn in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = %L',
      fn.schema_name,
      fn.function_name,
      fn.identity_args,
      ''
    );

    execute format(
      'revoke execute on function %I.%I(%s) from public, anon, authenticated',
      fn.schema_name,
      fn.function_name,
      fn.identity_args
    );

    execute format(
      'grant execute on function %I.%I(%s) to service_role',
      fn.schema_name,
      fn.function_name,
      fn.identity_args
    );
  end loop;
end
$$;

-- Future objects must be explicitly opened to browser roles. PostgreSQL grants
-- EXECUTE on new functions to PUBLIC by default, so remove that default for
-- migrations created by the migration owner in the public schema.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
