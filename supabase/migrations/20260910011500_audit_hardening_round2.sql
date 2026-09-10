-- Audit hardening round 2 — 2026-09-10.
-- Goals: service-only application data, atomic critical writes, strict bankroll
-- invariants, globally coordinated 5Dollar rate limiting, and idempotent retries.
-- IMPORTANT: this migration intentionally does not modify
-- supabase_migrations.schema_migrations; the existing migration-history drift is
-- handled by the recovery runbook rather than by fabricating history.

begin;

-- Business rule approved by the owner: the operational minimum is R$ 0.50.
update public.experimental_bankroll_config
set min_stake_brl = 0.50,
    updated_at = now()
where id = 'main';

-- Idempotency constraints for value-analysis retries.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_odds'::regclass
      and conname = 'user_odds_run_candidate_key'
  ) then
    alter table public.user_odds
      add constraint user_odds_run_candidate_key unique (run_id, candidate_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.value_evaluations'::regclass
      and conname = 'value_evaluations_run_candidate_key'
  ) then
    alter table public.value_evaluations
      add constraint value_evaluations_run_candidate_key unique (run_id, candidate_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.final_selections'::regclass
      and conname = 'final_selections_run_evaluation_key'
  ) then
    alter table public.final_selections
      add constraint final_selections_run_evaluation_key unique (run_id, evaluation_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.final_selections'::regclass
      and conname = 'final_selections_run_rank_key'
  ) then
    alter table public.final_selections
      add constraint final_selections_run_rank_key unique (run_id, rank);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.experimental_bet_tracking'::regclass
      and conname = 'experimental_bet_tracking_result_check'
  ) then
    alter table public.experimental_bet_tracking
      add constraint experimental_bet_tracking_result_check
      check (result in ('PENDING', 'WIN', 'LOSS', 'PUSH', 'VOID'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.experimental_bet_tracking'::regclass
      and conname = 'experimental_bet_tracking_operational_stake_check'
  ) then
    alter table public.experimental_bet_tracking
      add constraint experimental_bet_tracking_operational_stake_check
      check (
        bet_status not in ('OPEN', 'SETTLED')
        or (stake_brl is not null and stake_brl >= 0.50)
      );
  end if;
end
$$;

-- One process-independent limiter shared by every server instance.
create table if not exists public.external_api_rate_limit_state (
  bucket text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);
alter table public.external_api_rate_limit_state enable row level security;

-- Atomic creation of a run + upload metadata + match rows.
create or replace function public.app_create_run_atomic(
  p_target_date date,
  p_filename text,
  p_invalid_count integer,
  p_leagues text[],
  p_headers text[],
  p_rows jsonb,
  p_prediction_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_inserted integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) < 1
     or jsonb_array_length(p_rows) > 300 then
    raise exception using errcode = '22023', message = 'invalid match payload';
  end if;

  insert into public.analysis_runs (
    target_date, status, matches_total, notes
  ) values (
    p_target_date,
    'CREATED',
    jsonb_array_length(p_rows),
    jsonb_build_object('prediction_at', p_prediction_at)
  )
  returning id into v_run_id;

  insert into public.uploaded_files (
    run_id, filename, row_count, invalid_row_count, leagues, raw_headers
  ) values (
    v_run_id,
    left(trim(p_filename), 200),
    jsonb_array_length(p_rows),
    greatest(coalesce(p_invalid_count, 0), 0),
    coalesce(p_leagues, array[]::text[]),
    coalesce(p_headers, array[]::text[])
  );

  insert into public.matches (run_id, raw_partida, raw_horario, raw_campeonato)
  select
    v_run_id,
    left(trim(r.partida), 160),
    left(trim(r.horario), 32),
    left(trim(r.campeonato), 120)
  from jsonb_to_recordset(p_rows)
    as r(partida text, horario text, campeonato text)
  where nullif(trim(r.partida), '') is not null
    and nullif(trim(r.horario), '') is not null
    and nullif(trim(r.campeonato), '') is not null;

  get diagnostics v_inserted = row_count;
  if v_inserted <> jsonb_array_length(p_rows) then
    raise exception using errcode = '22023', message = 'one or more match rows were invalid';
  end if;

  return v_run_id;
end;
$$;

-- Atomic replacement of all Motor 2 persistence for one run. The model math
-- remains in TypeScript; this function only commits the already-calculated
-- audit trail as a single transaction.
create or replace function public.app_replace_value_results_atomic(
  p_run_id uuid,
  p_user_odds jsonb,
  p_evaluations jsonb,
  p_selections jsonb,
  p_completed_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected integer;
  v_inserted integer;
  v_selection_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if jsonb_typeof(coalesce(p_user_odds, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_evaluations, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_selections, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid value-analysis payload';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('value-run:' || p_run_id::text, 0)
  );
  perform 1 from public.analysis_runs where id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'analysis run not found';
  end if;

  delete from public.final_selections where run_id = p_run_id;
  delete from public.value_evaluations where run_id = p_run_id;
  delete from public.user_odds where run_id = p_run_id;

  insert into public.user_odds (
    run_id, candidate_id, bookmaker, odd, line_at_entry
  )
  select
    p_run_id, x.candidate_id, x.bookmaker, x.odd, x.line_at_entry
  from jsonb_to_recordset(coalesce(p_user_odds, '[]'::jsonb))
    as x(candidate_id uuid, bookmaker text, odd numeric, line_at_entry numeric)
  join public.market_candidates mc
    on mc.id = x.candidate_id and mc.run_id = p_run_id;
  get diagnostics v_inserted = row_count;
  v_expected := jsonb_array_length(coalesce(p_user_odds, '[]'::jsonb));
  if v_inserted <> v_expected then
    raise exception using errcode = '22023', message = 'user odds contained a candidate outside the run';
  end if;

  insert into public.value_evaluations (
    run_id, candidate_id, odd, implied_probability, fair_odd,
    min_odd_target, edge_cons, ev_cons, w_eff, l_eff,
    probability_status, value_status, execution_status, rejection_reason
  )
  select
    p_run_id,
    x.candidate_id,
    x.odd,
    x.implied_probability,
    x.fair_odd,
    x.min_odd_target,
    x.edge_cons,
    x.ev_cons,
    x.w_eff,
    x.l_eff,
    x.probability_status,
    x.value_status,
    x.execution_status,
    x.rejection_reason
  from jsonb_to_recordset(coalesce(p_evaluations, '[]'::jsonb)) as x(
    candidate_id uuid,
    odd numeric,
    implied_probability numeric,
    fair_odd numeric,
    min_odd_target numeric,
    edge_cons numeric,
    ev_cons numeric,
    w_eff numeric,
    l_eff numeric,
    probability_status text,
    value_status text,
    execution_status text,
    rejection_reason text
  )
  join public.market_candidates mc
    on mc.id = x.candidate_id and mc.run_id = p_run_id;
  get diagnostics v_inserted = row_count;
  v_expected := jsonb_array_length(coalesce(p_evaluations, '[]'::jsonb));
  if v_inserted <> v_expected then
    raise exception using errcode = '22023', message = 'evaluation contained a candidate outside the run';
  end if;

  insert into public.final_selections (run_id, evaluation_id, rank, explanation)
  select
    p_run_id,
    ve.id,
    s.rank,
    s.explanation
  from jsonb_to_recordset(coalesce(p_selections, '[]'::jsonb))
    as s(candidate_id uuid, rank integer, explanation text)
  join public.value_evaluations ve
    on ve.run_id = p_run_id and ve.candidate_id = s.candidate_id
  order by s.rank;
  get diagnostics v_selection_count = row_count;
  v_expected := jsonb_array_length(coalesce(p_selections, '[]'::jsonb));
  if v_selection_count <> v_expected then
    raise exception using errcode = '22023', message = 'selection did not map to a persisted evaluation';
  end if;
  if v_selection_count > 3 then
    raise exception using errcode = '22023', message = 'final selection limit exceeded';
  end if;

  update public.analysis_runs
  set selections_count = v_selection_count,
      status = 'COMPLETED',
      updated_at = coalesce(p_completed_at, now())
  where id = p_run_id;

  return jsonb_build_object(
    'status', 'OK',
    'evaluations', jsonb_array_length(coalesce(p_evaluations, '[]'::jsonb)),
    'selections', v_selection_count
  );
end;
$$;

-- Global fixed-window coordinator. Callers that receive wait_ms > 0 must wait
-- and ask again before making an external request. A coordinator failure is
-- intentionally fail-closed in the server adapter.
create or replace function public.external_api_take_rate_slot(
  p_bucket text,
  p_limit integer default 9,
  p_window_ms integer default 60000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_started timestamptz;
  v_count integer;
  v_elapsed_ms numeric;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_bucket <> 'five_dollar_football'
     or p_limit < 1 or p_limit > 20
     or p_window_ms < 1000 or p_window_ms > 300000 then
    raise exception using errcode = '22023', message = 'invalid rate-limit request';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('api-rate:' || p_bucket, 0)
  );

  select window_started_at, request_count
    into v_started, v_count
  from public.external_api_rate_limit_state
  where bucket = p_bucket
  for update;

  if not found then
    insert into public.external_api_rate_limit_state (
      bucket, window_started_at, request_count, updated_at
    ) values (p_bucket, v_now, 1, v_now);
    return 0;
  end if;

  v_elapsed_ms := extract(epoch from (v_now - v_started)) * 1000;
  if v_elapsed_ms >= p_window_ms then
    update public.external_api_rate_limit_state
    set window_started_at = v_now,
        request_count = 1,
        updated_at = v_now
    where bucket = p_bucket;
    return 0;
  end if;

  if v_count < p_limit then
    update public.external_api_rate_limit_state
    set request_count = request_count + 1,
        updated_at = v_now
    where bucket = p_bucket;
    return 0;
  end if;

  return greatest(1, ceil(p_window_ms - v_elapsed_ms)::integer);
end;
$$;

-- Enforce bankroll invariants at the database boundary, including direct
-- updates from the analytics screen. This closes cross-tab/process races even
-- if callers read a slightly stale snapshot before issuing their UPDATE.
create or replace function private.experimental_tracking_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initial numeric;
  v_max_pct numeric;
  v_equity numeric;
  v_locked numeric;
  v_available numeric;
  v_max_allowed numeric;
  v_min numeric := 0.50;
begin
  if tg_op = 'UPDATE' then
    if old.bet_status = 'SETTLED' and (
      new.bet_status is distinct from old.bet_status
      or new.result is distinct from old.result
      or new.stake_brl is distinct from old.stake_brl
      or new.profit_units is distinct from old.profit_units
      or new.profit_brl is distinct from old.profit_brl
    ) then
      raise exception using errcode = '23514', message = 'settled bankroll entry is immutable';
    end if;

    if not (
      (old.bet_status = 'PROPOSED' and new.bet_status in ('PROPOSED','OPEN','DECLINED'))
      or (old.bet_status = 'OPEN' and new.bet_status in ('OPEN','SETTLED'))
      or (old.bet_status = 'DECLINED' and new.bet_status = 'DECLINED')
      or (old.bet_status = 'SETTLED' and new.bet_status = 'SETTLED')
    ) then
      raise exception using errcode = '23514', message = 'invalid bankroll state transition';
    end if;
  end if;

  if new.bet_status in ('OPEN', 'SETTLED')
     and (new.stake_brl is null or new.stake_brl < v_min) then
    raise exception using errcode = '23514', message = 'minimum operational stake is BRL 0.50';
  end if;
  if new.bet_status = 'OPEN' and new.result <> 'PENDING' then
    raise exception using errcode = '23514', message = 'open bet must have PENDING result';
  end if;
  if new.bet_status = 'SETTLED' and new.result = 'PENDING' then
    raise exception using errcode = '23514', message = 'settled bet requires a final result';
  end if;

  if new.bet_status = 'OPEN' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('experimental-bankroll', 0)
    );

    select initial_bankroll, max_stake_pct
      into v_initial, v_max_pct
    from public.experimental_bankroll_config
    where id = 'main';
    if not found then
      raise exception using errcode = 'P0002', message = 'bankroll config not found';
    end if;

    select
      v_initial + coalesce(sum(profit_brl) filter (
        where (bet_status = 'SETTLED' or result <> 'PENDING')
          and id <> new.id
      ), 0),
      coalesce(sum(stake_brl) filter (
        where bet_status = 'OPEN' and result = 'PENDING'
          and id <> new.id
      ), 0)
      into v_equity, v_locked
    from public.experimental_bet_tracking;

    v_available := greatest(0, v_equity - v_locked);
    if v_available < v_min then
      v_max_allowed := 0;
    else
      v_max_allowed := least(
        v_available,
        greatest(v_min, floor(v_available * v_max_pct * 100) / 100)
      );
    end if;

    if new.stake_brl > v_max_allowed then
      raise exception using
        errcode = '23514',
        message = format('stake exceeds operational limit (max %s)', v_max_allowed);
    end if;
  end if;

  return new;
end;
$$;

-- Serialize acquisition of the 2/3 daily experimental selection slots. This
-- protects every INSERT path, not only the current UI implementation.
create or replace function private.experimental_selection_limit_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_date date;
  v_limit integer;
  v_active integer;
  v_old_active boolean := false;
  v_new_active boolean := new.bet_status in ('PROPOSED','OPEN','SETTLED');
begin
  if tg_op = 'UPDATE' then
    v_old_active := old.bet_status in ('PROPOSED','OPEN','SETTLED');
  end if;
  if not v_new_active or v_old_active then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('experimental-selection:' || new.run_id::text, 0)
  );

  select target_date into v_target_date
  from public.analysis_runs
  where id = new.run_id;
  if not found then
    raise exception using errcode = '23503', message = 'analysis run not found';
  end if;

  v_limit := case
    when extract(dow from v_target_date) in (0, 6) then 3
    else 2
  end;

  select count(*) into v_active
  from public.experimental_bet_tracking
  where run_id = new.run_id
    and bet_status in ('PROPOSED','OPEN','SETTLED');

  if v_active >= v_limit then
    raise exception using
      errcode = '23514',
      message = format('experimental selection limit is %s for this run', v_limit);
  end if;

  return new;
end;
$$;

-- Recreate guards idempotently.
drop trigger if exists experimental_tracking_guard on public.experimental_bet_tracking;
create trigger experimental_tracking_guard
before insert or update on public.experimental_bet_tracking
for each row execute function private.experimental_tracking_guard();

drop trigger if exists experimental_selection_limit_guard on public.experimental_bet_tracking;
create trigger experimental_selection_limit_guard
before insert or update of bet_status on public.experimental_bet_tracking
for each row execute function private.experimental_selection_limit_guard();

-- Browser roles have no direct application-data surface. Auth uses the Auth API;
-- every application data operation goes through authenticated server functions
-- and a service-role client.
revoke usage on schema public from anon, authenticated;
grant usage on schema public to service_role;

-- Relations and sequences.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke all on table public.%I from public, anon, authenticated', r.tablename);
    execute format('grant all on table public.%I to service_role', r.tablename);
  end loop;
  for r in select viewname from pg_views where schemaname = 'public' loop
    execute format('revoke all on table public.%I from public, anon, authenticated', r.viewname);
    execute format('grant select on table public.%I to service_role', r.viewname);
  end loop;
  for r in select matviewname from pg_matviews where schemaname = 'public' loop
    execute format('revoke all on table public.%I from public, anon, authenticated', r.matviewname);
    execute format('grant select on table public.%I to service_role', r.matviewname);
  end loop;
  for r in select sequencename from pg_sequences where schemaname = 'public' loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated', r.sequencename);
    execute format('grant all on sequence public.%I to service_role', r.sequencename);
  end loop;
end
$$;

-- Every public RPC is internal in this single-user architecture.
do $$
declare r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format(
      'revoke all on function public.%I(%s) from public, anon, authenticated',
      r.proname, r.args
    );
    execute format(
      'grant execute on function public.%I(%s) to service_role',
      r.proname, r.args
    );
  end loop;
end
$$;

revoke all on function private.experimental_tracking_guard() from public, anon, authenticated;
revoke all on function private.experimental_selection_limit_guard() from public, anon, authenticated;

commit;
