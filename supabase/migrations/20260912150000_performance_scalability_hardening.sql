-- Performance and scalability hardening.
-- Keeps business rules unchanged while bounding growth, reducing scan cost and
-- preventing background maintenance from competing with user analysis work.

-- Hot-path indexes observed as sequential scans in production.
create index if not exists idx_model_predictions_run_id
  on public.model_predictions(run_id);
create index if not exists idx_normalized_match_stats_run_id
  on public.normalized_match_stats(run_id);
create index if not exists idx_source_fetches_run_id
  on public.source_fetches(run_id);
create index if not exists idx_source_fetches_run_fetched_at
  on public.source_fetches(run_id, fetched_at desc);
create index if not exists idx_raw_observations_run_observed_at
  on public.raw_observations(run_id, observed_at);
create index if not exists idx_raw_observations_source_definition
  on public.raw_observations(source, definition_version);
create index if not exists idx_raw_observations_cache_key
  on public.raw_observations(source, definition_version, ((raw_value ->> 'cacheKey')))
  where raw_value ? 'cacheKey';
create index if not exists idx_analysis_runs_owner_status_created
  on public.analysis_runs(owner_id, status, created_at desc);
create index if not exists idx_tracking_run_status_result
  on public.experimental_bet_tracking(run_id, bet_status, result);

-- Server-side aggregation avoids loading every run id and every tracking row
-- just to render the home page.
create or replace function public.get_owner_home_metrics(p_owner_id uuid)
returns table(
  open_bets_count bigint,
  proposed_count bigint,
  settled_profit numeric,
  locked_stake numeric
)
language sql
stable
security definer
set search_path=''
as $$
  select
    count(*) filter (where t.bet_status='OPEN' and t.result='PENDING')::bigint,
    count(*) filter (where t.bet_status='PROPOSED')::bigint,
    coalesce(sum(t.profit_brl) filter (where t.bet_status='SETTLED' or t.result<>'PENDING'),0)::numeric,
    coalesce(sum(t.stake_brl) filter (where t.bet_status='OPEN' and t.result='PENDING'),0)::numeric
  from public.experimental_bet_tracking t
  join public.analysis_runs r on r.id=t.run_id
  where r.owner_id=p_owner_id;
$$;
revoke all on function public.get_owner_home_metrics(uuid) from public, anon, authenticated;
grant execute on function public.get_owner_home_metrics(uuid) to service_role;

-- Reusable bankroll aggregate for server functions. This leaves the existing
-- atomic confirmation RPC as the source of truth for write-time validation.
create or replace function public.get_owner_bankroll_metrics(p_owner_id uuid)
returns table(
  initial_bankroll numeric,
  max_stake_pct numeric,
  fractional_kelly numeric,
  min_stake_brl numeric,
  settled_profit numeric,
  locked_stake numeric,
  current_equity numeric,
  available_bankroll numeric
)
language sql
stable
security definer
set search_path=''
as $$
  with tracking as (
    select
      coalesce(sum(t.profit_brl) filter (where t.bet_status='SETTLED' or t.result<>'PENDING'),0)::numeric as profit,
      coalesce(sum(t.stake_brl) filter (where t.bet_status='OPEN' and t.result='PENDING'),0)::numeric as locked
    from public.experimental_bet_tracking t
    join public.analysis_runs r on r.id=t.run_id
    where r.owner_id=p_owner_id
  )
  select
    c.initial_bankroll,
    c.max_stake_pct,
    c.fractional_kelly,
    c.min_stake_brl,
    tracking.profit,
    tracking.locked,
    (c.initial_bankroll + tracking.profit)::numeric,
    greatest(0, c.initial_bankroll + tracking.profit - tracking.locked)::numeric
  from public.experimental_bankroll_config c
  cross join tracking
  where c.id='main' and c.owner_id=p_owner_id;
$$;
revoke all on function public.get_owner_bankroll_metrics(uuid) from public, anon, authenticated;
grant execute on function public.get_owner_bankroll_metrics(uuid) to service_role;

-- Owner-scoped history helpers remove the growing list of run ids from server
-- queries while preserving the exact tracking rows expected by the UI.
create or replace function public.get_owner_tracking_history(p_owner_id uuid, p_limit integer default 5000)
returns setof public.experimental_bet_tracking
language sql
stable
security definer
set search_path=''
as $$
  select t.*
  from public.experimental_bet_tracking t
  join public.analysis_runs r on r.id=t.run_id
  where r.owner_id=p_owner_id
  order by t.target_date desc nulls last, t.created_at desc
  limit greatest(1, least(coalesce(p_limit,5000),5000));
$$;
revoke all on function public.get_owner_tracking_history(uuid,integer) from public, anon, authenticated;
grant execute on function public.get_owner_tracking_history(uuid,integer) to service_role;

create or replace function public.get_owner_open_bets(p_owner_id uuid)
returns setof public.experimental_bet_tracking
language sql
stable
security definer
set search_path=''
as $$
  select t.*
  from public.experimental_bet_tracking t
  join public.analysis_runs r on r.id=t.run_id
  where r.owner_id=p_owner_id
    and t.bet_status='OPEN'
    and t.result='PENDING'
  order by t.target_date asc nulls last, t.accepted_at asc nulls last;
$$;
revoke all on function public.get_owner_open_bets(uuid) from public, anon, authenticated;
grant execute on function public.get_owner_open_bets(uuid) to service_role;

-- Targeted cache lookup. The previous implementation loaded up to 5,000 JSON
-- payloads then searched them in application memory. This function uses the
-- cache-key expression index and returns only the requested keys.
create or replace function public.get_raw_observation_cache_rows(
  p_source text,
  p_definition_version text,
  p_cache_keys text[]
)
returns table(
  cache_key text,
  metric text,
  raw_value jsonb,
  observed_at timestamptz,
  fetched_at timestamptz
)
language sql
stable
security definer
set search_path=''
as $$
  select
    ro.raw_value ->> 'cacheKey' as cache_key,
    ro.metric,
    ro.raw_value,
    ro.observed_at,
    ro.fetched_at
  from public.raw_observations ro
  where ro.source=p_source
    and ro.definition_version=p_definition_version
    and ro.raw_value ? 'cacheKey'
    and (ro.raw_value ->> 'cacheKey') = any(coalesce(p_cache_keys,'{}'::text[]));
$$;
revoke all on function public.get_raw_observation_cache_rows(text,text,text[]) from public, anon, authenticated;
grant execute on function public.get_raw_observation_cache_rows(text,text,text[]) to service_role;

-- Lightweight real-user performance telemetry. No account identifier is stored;
-- authentication is checked by the server function before insertion.
create table if not exists public.performance_vitals (
  id bigint generated by default as identity primary key,
  metric text not null check (metric in ('LCP','CLS','INP','TTFB')),
  value double precision not null check (value >= 0),
  rating text not null check (rating in ('good','needs-improvement','poor')),
  route text not null,
  created_at timestamptz not null default now()
);
alter table public.performance_vitals enable row level security;
revoke all on public.performance_vitals from public, anon, authenticated;
grant select, insert, delete on public.performance_vitals to service_role;
grant usage, select on sequence public.performance_vitals_id_seq to service_role;
create index if not exists idx_performance_vitals_metric_created
  on public.performance_vitals(metric, created_at desc);

-- Bound the largest append-only operational tables. Only finalized/completed
-- analyses older than 90 days lose raw provider payloads; normalized/model/
-- decision outputs remain available for product history. Fetch/log telemetry is
-- retained for 180 days. No current data is affected by this migration.
create or replace function public.run_performance_retention_cleanup()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_raw integer := 0;
  v_fetches integer := 0;
  v_logs integer := 0;
  v_vitals integer := 0;
begin
  delete from public.raw_observations ro
  using public.analysis_runs r
  where ro.run_id=r.id
    and r.created_at < now() - interval '90 days'
    and (r.selection_finalized_at is not null or r.status='COMPLETED');
  get diagnostics v_raw = row_count;

  delete from public.source_fetches sf
  using public.analysis_runs r
  where sf.run_id=r.id
    and r.created_at < now() - interval '180 days'
    and (r.selection_finalized_at is not null or r.status='COMPLETED');
  get diagnostics v_fetches = row_count;

  delete from public.pipeline_logs pl
  using public.analysis_runs r
  where pl.run_id=r.id
    and r.created_at < now() - interval '180 days'
    and (r.selection_finalized_at is not null or r.status='COMPLETED');
  get diagnostics v_logs = row_count;

  delete from public.performance_vitals where created_at < now() - interval '30 days';
  get diagnostics v_vitals = row_count;

  return jsonb_build_object(
    'raw_observations_deleted',v_raw,
    'source_fetches_deleted',v_fetches,
    'pipeline_logs_deleted',v_logs,
    'performance_vitals_deleted',v_vitals,
    'executed_at',now()
  );
end;
$$;
revoke all on function public.run_performance_retention_cleanup() from public, anon, authenticated;
grant execute on function public.run_performance_retention_cleanup() to service_role;

-- Background Elo/API maintenance yields to user analysis work and cannot overlap
-- itself. This protects database IO and the shared external-provider budget.
create or replace function public.elo_sync_next_target_when_idle()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  if not pg_try_advisory_xact_lock(hashtext('elo_sync_next_target_when_idle')) then
    return jsonb_build_object('status','SKIPPED','reason','already_running');
  end if;
  if exists(select 1 from public.analysis_jobs where status in ('QUEUED','RUNNING')) then
    return jsonb_build_object('status','SKIPPED','reason','analysis_busy');
  end if;
  perform public.elo_sync_next_target();
  return jsonb_build_object('status','EXECUTED','executed_at',now());
end;
$$;

create or replace function public.kick_external_api_maintenance_when_idle()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  if not pg_try_advisory_xact_lock(hashtext('external_api_maintenance_when_idle')) then
    return jsonb_build_object('status','SKIPPED','reason','already_running');
  end if;
  if exists(select 1 from public.analysis_jobs where status in ('QUEUED','RUNNING')) then
    return jsonb_build_object('status','SKIPPED','reason','analysis_busy');
  end if;
  perform public.kick_external_api_maintenance();
  return jsonb_build_object('status','EXECUTED','executed_at',now());
end;
$$;
revoke all on function public.elo_sync_next_target_when_idle() from public, anon, authenticated;
revoke all on function public.kick_external_api_maintenance_when_idle() from public, anon, authenticated;
grant execute on function public.elo_sync_next_target_when_idle() to service_role;
grant execute on function public.kick_external_api_maintenance_when_idle() to service_role;

-- Replace schedules deterministically while preserving their cadence.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname='elo-daily-incremental';
  perform cron.unschedule(jobid) from cron.job where jobname='five-dollar-maintenance-daily';
  perform cron.unschedule(jobid) from cron.job where jobname='performance-retention-daily';
exception when undefined_table then
  null;
end $$;

select cron.schedule('elo-daily-incremental','*/2 6-7 * * *','select public.elo_sync_next_target_when_idle();');
select cron.schedule('five-dollar-maintenance-daily','10,25,40,55 6 * * *','select public.kick_external_api_maintenance_when_idle();');
select cron.schedule('performance-retention-daily','15 4 * * *','select public.run_performance_retention_cleanup();');

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260912-performance-scalability-hardening',
  'performance_scalability_hardening',
  'Adds hot-path indexes, owner aggregates/history helpers, targeted raw cache lookup, bounded operational retention, Web Vitals storage and idle-aware background maintenance.'
)
on conflict (version) do update set
  migration_name=excluded.migration_name,
  notes=excluded.notes,
  applied_at=now();