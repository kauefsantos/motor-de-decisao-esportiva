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

-- 3) Privileged SECURITY DEFINER functions are internal-only. pg_cron jobs run
-- as postgres and are unaffected by revoking browser-role EXECUTE.
revoke execute on function public.elo_after_sync_rebuild() from public, anon, authenticated;
revoke execute on function public.elo_bootstrap_runner() from public, anon, authenticated;
revoke execute on function public.elo_finalize_daily() from public, anon, authenticated;
revoke execute on function public.elo_rebuild_league(bigint) from public, anon, authenticated;
revoke execute on function public.elo_rebuild_league_ratings() from public, anon, authenticated;
revoke execute on function public.elo_refresh_cross_fixtures_from_raw() from public, anon, authenticated;
revoke execute on function public.elo_run_audit() from public, anon, authenticated;
revoke execute on function public.elo_seed_rating(bigint,bigint,timestamptz) from public, anon, authenticated;
revoke execute on function public.elo_seed_rebuild_runner() from public, anon, authenticated;
revoke execute on function public.elo_store_5dollar_key(text) from public, anon, authenticated;
revoke execute on function public.elo_sync_cross_competition(bigint) from public, anon, authenticated;
revoke execute on function public.elo_sync_domestic_league(bigint) from public, anon, authenticated;
revoke execute on function public.elo_sync_from_5dollar() from public, anon, authenticated;
revoke execute on function public.elo_sync_next_target() from public, anon, authenticated;

grant execute on function public.elo_after_sync_rebuild() to service_role;
grant execute on function public.elo_bootstrap_runner() to service_role;
grant execute on function public.elo_finalize_daily() to service_role;
grant execute on function public.elo_rebuild_league(bigint) to service_role;
grant execute on function public.elo_rebuild_league_ratings() to service_role;
grant execute on function public.elo_refresh_cross_fixtures_from_raw() to service_role;
grant execute on function public.elo_run_audit() to service_role;
grant execute on function public.elo_seed_rating(bigint,bigint,timestamptz) to service_role;
grant execute on function public.elo_seed_rebuild_runner() to service_role;
grant execute on function public.elo_store_5dollar_key(text) to service_role;
grant execute on function public.elo_sync_cross_competition(bigint) to service_role;
grant execute on function public.elo_sync_domestic_league(bigint) to service_role;
grant execute on function public.elo_sync_from_5dollar() to service_role;
grant execute on function public.elo_sync_next_target() to service_role;

-- 4) The old HTTP cron bearer table is obsolete: jobs now execute database
-- functions directly through pg_cron. Remove stored bearer material entirely.
drop table if exists public.elo_cron_config;

-- 5) Browser roles do not need direct access to the cron schema.
revoke usage on schema cron from anon, authenticated;
