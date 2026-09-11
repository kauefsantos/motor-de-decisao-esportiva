-- Defense-in-depth ownership and authorization hardening.
-- The application remains private/single-user, but user-scoped data now has an
-- explicit ownership root so an accidental future auth expansion cannot silently
-- become cross-account data access.

create schema if not exists private;
revoke all on schema private from public, anon;

-- Canonical ownership root for every analysis and its run-scoped descendants.
alter table public.analysis_runs
  add column if not exists owner_id uuid references auth.users(id) on delete restrict;

-- Reconcile existing production rows with the currently approved Google account.
do $$
declare
  approved_user uuid;
begin
  select id into approved_user
  from auth.users
  where lower(trim(coalesce(email, ''))) = 'kauefsantos3@gmail.com'
    and coalesce(raw_app_meta_data ->> 'provider', '') = 'google'
  order by created_at
  limit 1;

  if approved_user is not null then
    update public.analysis_runs
    set owner_id = approved_user
    where owner_id is null;
  end if;

  if exists (select 1 from public.analysis_runs where owner_id is null) then
    raise exception 'Cannot harden analysis_runs ownership: existing rows have no approved owner';
  end if;
end
$$;

alter table public.analysis_runs alter column owner_id set not null;
create index if not exists analysis_runs_owner_created_idx
  on public.analysis_runs (owner_id, created_at desc);

-- Bankroll is personal state. Keep backwards compatibility with the current
-- singleton id while recording its owner for authorization and future migration.
alter table public.experimental_bankroll_config
  add column if not exists owner_id uuid references auth.users(id) on delete restrict;

do $$
declare
  approved_user uuid;
begin
  select id into approved_user
  from auth.users
  where lower(trim(coalesce(email, ''))) = 'kauefsantos3@gmail.com'
    and coalesce(raw_app_meta_data ->> 'provider', '') = 'google'
  order by created_at
  limit 1;

  if approved_user is not null then
    update public.experimental_bankroll_config
    set owner_id = approved_user
    where owner_id is null;
  end if;
end
$$;

create index if not exists experimental_bankroll_config_owner_idx
  on public.experimental_bankroll_config (owner_id);

-- Safe helpers used only by RLS. They derive identity from the verified JWT;
-- callers cannot ask whether another arbitrary user owns a resource.
create or replace function private.is_authorized_app_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and lower(trim(coalesce(u.email, ''))) = 'kauefsantos3@gmail.com'
      and coalesce(u.raw_app_meta_data ->> 'provider', '') = 'google'
  );
$$;

create or replace function private.owns_run(p_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_authorized_app_user()
    and exists (
      select 1
      from public.analysis_runs r
      where r.id = p_run_id
        and r.owner_id = auth.uid()
    );
$$;

create or replace function private.owns_match(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_authorized_app_user()
    and exists (
      select 1
      from public.matches m
      join public.analysis_runs r on r.id = m.run_id
      where m.id = p_match_id
        and r.owner_id = auth.uid()
    );
$$;

revoke all on function private.is_authorized_app_user() from public, anon;
revoke all on function private.owns_run(uuid) from public, anon;
revoke all on function private.owns_match(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_authorized_app_user() to authenticated;
grant execute on function private.owns_run(uuid) to authenticated;
grant execute on function private.owns_match(uuid) to authenticated;

-- Root ownership policy. Browser relation grants stay revoked; these policies are
-- an independent row boundary if a narrow grant is ever introduced later.
drop policy if exists analysis_runs_owner_select on public.analysis_runs;
drop policy if exists analysis_runs_owner_insert on public.analysis_runs;
drop policy if exists analysis_runs_owner_update on public.analysis_runs;
drop policy if exists analysis_runs_owner_delete on public.analysis_runs;
create policy analysis_runs_owner_select on public.analysis_runs for select to authenticated
  using (private.is_authorized_app_user() and owner_id = (select auth.uid()));
create policy analysis_runs_owner_insert on public.analysis_runs for insert to authenticated
  with check (private.is_authorized_app_user() and owner_id = (select auth.uid()));
create policy analysis_runs_owner_update on public.analysis_runs for update to authenticated
  using (private.is_authorized_app_user() and owner_id = (select auth.uid()))
  with check (private.is_authorized_app_user() and owner_id = (select auth.uid()));
create policy analysis_runs_owner_delete on public.analysis_runs for delete to authenticated
  using (private.is_authorized_app_user() and owner_id = (select auth.uid()));

-- Every relation whose rows belong to a run inherits authorization from
-- analysis_runs.owner_id. Policy names are intentionally identical per table.
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'elo_prediction_context',
    'experimental_bet_tracking',
    'experimental_odds_snapshots',
    'experimental_value_evaluations',
    'experimental_analysis_results',
    'final_selections',
    'market_candidates',
    'matches',
    'model_predictions',
    'normalized_match_stats',
    'pipeline_logs',
    'raw_observations',
    'source_fetches',
    'uploaded_files',
    'user_odds',
    'value_evaluations'
  ]
  loop
    if to_regclass(format('public.%I', relation_name)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', relation_name);
    execute format('alter table public.%I force row level security', relation_name);
    execute format('drop policy if exists run_owner_select on public.%I', relation_name);
    execute format('drop policy if exists run_owner_insert on public.%I', relation_name);
    execute format('drop policy if exists run_owner_update on public.%I', relation_name);
    execute format('drop policy if exists run_owner_delete on public.%I', relation_name);
    execute format('create policy run_owner_select on public.%I for select to authenticated using (private.owns_run(run_id))', relation_name);
    execute format('create policy run_owner_insert on public.%I for insert to authenticated with check (private.owns_run(run_id))', relation_name);
    execute format('create policy run_owner_update on public.%I for update to authenticated using (private.owns_run(run_id)) with check (private.owns_run(run_id))', relation_name);
    execute format('create policy run_owner_delete on public.%I for delete to authenticated using (private.owns_run(run_id))', relation_name);
  end loop;
end
$$;

-- match_external_ids does not carry run_id, so inherit ownership through match_id.
alter table public.match_external_ids enable row level security;
alter table public.match_external_ids force row level security;
drop policy if exists match_owner_select on public.match_external_ids;
drop policy if exists match_owner_insert on public.match_external_ids;
drop policy if exists match_owner_update on public.match_external_ids;
drop policy if exists match_owner_delete on public.match_external_ids;
create policy match_owner_select on public.match_external_ids for select to authenticated
  using (private.owns_match(match_id));
create policy match_owner_insert on public.match_external_ids for insert to authenticated
  with check (private.owns_match(match_id));
create policy match_owner_update on public.match_external_ids for update to authenticated
  using (private.owns_match(match_id)) with check (private.owns_match(match_id));
create policy match_owner_delete on public.match_external_ids for delete to authenticated
  using (private.owns_match(match_id));

-- Existing explicitly user-owned relations.
alter table public.analysis_jobs force row level security;
drop policy if exists analysis_jobs_owner_select on public.analysis_jobs;
drop policy if exists analysis_jobs_owner_insert on public.analysis_jobs;
drop policy if exists analysis_jobs_owner_update on public.analysis_jobs;
drop policy if exists analysis_jobs_owner_delete on public.analysis_jobs;
create policy analysis_jobs_owner_select on public.analysis_jobs for select to authenticated
  using (private.is_authorized_app_user() and user_id = (select auth.uid()) and private.owns_run(run_id));
create policy analysis_jobs_owner_insert on public.analysis_jobs for insert to authenticated
  with check (private.is_authorized_app_user() and user_id = (select auth.uid()) and private.owns_run(run_id));
create policy analysis_jobs_owner_update on public.analysis_jobs for update to authenticated
  using (private.is_authorized_app_user() and user_id = (select auth.uid()) and private.owns_run(run_id))
  with check (private.is_authorized_app_user() and user_id = (select auth.uid()) and private.owns_run(run_id));
create policy analysis_jobs_owner_delete on public.analysis_jobs for delete to authenticated
  using (private.is_authorized_app_user() and user_id = (select auth.uid()) and private.owns_run(run_id));

alter table public.push_subscriptions force row level security;
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions for select to authenticated
  using (private.is_authorized_app_user() and user_id = (select auth.uid()));
create policy push_subscriptions_insert_own on public.push_subscriptions for insert to authenticated
  with check (private.is_authorized_app_user() and user_id = (select auth.uid()));
create policy push_subscriptions_update_own on public.push_subscriptions for update to authenticated
  using (private.is_authorized_app_user() and user_id = (select auth.uid()))
  with check (private.is_authorized_app_user() and user_id = (select auth.uid()));
create policy push_subscriptions_delete_own on public.push_subscriptions for delete to authenticated
  using (private.is_authorized_app_user() and user_id = (select auth.uid()));

alter table public.experimental_bankroll_config force row level security;
drop policy if exists bankroll_owner_select on public.experimental_bankroll_config;
drop policy if exists bankroll_owner_insert on public.experimental_bankroll_config;
drop policy if exists bankroll_owner_update on public.experimental_bankroll_config;
drop policy if exists bankroll_owner_delete on public.experimental_bankroll_config;
create policy bankroll_owner_select on public.experimental_bankroll_config for select to authenticated
  using (private.is_authorized_app_user() and owner_id = (select auth.uid()));
create policy bankroll_owner_insert on public.experimental_bankroll_config for insert to authenticated
  with check (private.is_authorized_app_user() and owner_id = (select auth.uid()));
create policy bankroll_owner_update on public.experimental_bankroll_config for update to authenticated
  using (private.is_authorized_app_user() and owner_id = (select auth.uid()))
  with check (private.is_authorized_app_user() and owner_id = (select auth.uid()));
create policy bankroll_owner_delete on public.experimental_bankroll_config for delete to authenticated
  using (private.is_authorized_app_user() and owner_id = (select auth.uid()));

-- A background job can never be attached to a user different from the run owner,
-- even when written by service_role (RLS-bypassing code).
create or replace function private.enforce_analysis_job_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.analysis_runs r
    where r.id = new.run_id and r.owner_id = new.user_id
  ) then
    raise exception using errcode = '42501', message = 'analysis job owner does not match run owner';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_analysis_job_owner() from public, anon, authenticated;
drop trigger if exists enforce_analysis_job_owner on public.analysis_jobs;
create trigger enforce_analysis_job_owner
before insert or update of run_id, user_id on public.analysis_jobs
for each row execute function private.enforce_analysis_job_owner();

-- Keep all browser access deny-by-default. RLS is a second boundary, not an
-- excuse to broaden the Data API surface.
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

-- Views stay internal and, on PostgreSQL 15+, obey invoker permissions as an
-- additional safeguard if a grant is ever introduced accidentally.
do $$
declare
  view_name text;
begin
  foreach view_name in array array['elo_audit_leagues','elo_global_team_ratings','elo_team_integrity_audit']
  loop
    if to_regclass(format('public.%I', view_name)) is not null then
      execute format('alter view public.%I set (security_invoker = true)', view_name);
      execute format('revoke all on table public.%I from public, anon, authenticated', view_name);
    end if;
  end loop;
end
$$;
