-- Security hardening after 2026-09-09 audit.
-- Keep application data private to server-side service_role until Google auth
-- and the single-user allowlist are introduced in a later change.

-- 1) Close the only public table that still had RLS disabled.
alter table public.elo_seed_rebuild_queue enable row level security;
revoke all on table public.elo_seed_rebuild_queue from public, anon, authenticated;
grant all on table public.elo_seed_rebuild_queue to service_role;

-- 2) Internal Elo views must not expose model IP to browser roles.
revoke all on table public.elo_audit_leagues from public, anon, authenticated;
revoke all on table public.elo_global_team_ratings from public, anon, authenticated;
revoke all on table public.elo_team_integrity_audit from public, anon, authenticated;
grant select on table public.elo_audit_leagues to service_role;
grant select on table public.elo_global_team_ratings to service_role;
grant select on table public.elo_team_integrity_audit to service_role;

-- 3) Every privileged SECURITY DEFINER function that exists at this stage is
-- internal-only. Iterate over the catalog instead of naming runtime-only
-- functions so the versioned migration chain remains reproducible on a fresh DB.
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

-- 4) The old HTTP cron bearer table is obsolete: jobs now execute database
-- functions directly through pg_cron. Remove stored bearer material entirely.
drop table if exists public.elo_cron_config;

-- 5) Browser roles do not need direct access to the cron schema.
revoke usage on schema cron from anon, authenticated;
