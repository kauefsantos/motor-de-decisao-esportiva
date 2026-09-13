-- Stage 5: preserve the price that created the decision, but require a newly
-- confirmed Bet365 quote before any positive operational stake is opened.

alter table public.experimental_bet_tracking
  add column if not exists decision_odd numeric,
  add column if not exists decision_expected_value numeric,
  add column if not exists decision_edge numeric,
  add column if not exists decision_quote_captured_at timestamptz,
  add column if not exists execution_quote_captured_at timestamptz,
  add column if not exists execution_quote_source text;

update public.experimental_bet_tracking
set decision_odd = coalesce(decision_odd, entry_odd),
    decision_expected_value = coalesce(decision_expected_value, expected_value),
    decision_edge = coalesce(decision_edge, edge)
where decision_odd is null
   or (decision_expected_value is null and expected_value is not null)
   or (decision_edge is null and edge is not null);

alter table public.experimental_bet_tracking
  drop constraint if exists experimental_bet_tracking_execution_quote_source_check;
alter table public.experimental_bet_tracking
  add constraint experimental_bet_tracking_execution_quote_source_check
  check (execution_quote_source is null or execution_quote_source in ('USER_CONFIRMED_BET365'));

create or replace function public.accept_decision_opportunity_atomic(p_queue_id uuid, p_owner_id uuid)
returns table(accepted boolean, accepted_count integer, ready_for_stake boolean)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_q public.decision_opportunity_queue%rowtype;
  v_target date;
  v_count integer;
  v_exhausted boolean;
  v_finalized timestamptz;
begin
  select q.* into v_q
  from public.decision_opportunity_queue q
  join public.analysis_runs r on r.id=q.run_id
  where q.id=p_queue_id and r.owner_id=p_owner_id
  for update of q;
  if not found then raise exception 'Opção não encontrada.'; end if;

  select r.target_date,r.selection_finalized_at into v_target,v_finalized
  from public.analysis_runs r where r.id=v_q.run_id for update;
  if v_finalized is not null then raise exception 'A seleção desta análise já foi finalizada.'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_id::text||':'||coalesce(v_target::text,'sem-data'),0)
  );

  select count(*) into v_count
  from public.decision_opportunity_queue q
  join public.analysis_runs r on r.id=q.run_id
  where r.owner_id=p_owner_id
    and r.target_date is not distinct from v_target
    and q.queue_state='ACCEPTED';
  if v_count>=3 then raise exception 'Limite diário de 3 escolhas atingido.'; end if;

  if v_q.match_id is not null and exists(
    select 1
    from public.decision_opportunity_queue q
    join public.analysis_runs r on r.id=q.run_id
    where r.owner_id=p_owner_id
      and r.target_date is not distinct from v_target
      and q.match_id=v_q.match_id
      and q.queue_state='ACCEPTED'
      and q.id<>v_q.id
  ) then
    raise exception 'Já existe uma escolha aceita para esta partida.';
  end if;

  if v_q.queue_state<>'SHOWN' then
    return query select false,v_count,false;
    return;
  end if;

  update public.decision_opportunity_queue
  set queue_state='ACCEPTED',updated_at=pg_catalog.now()
  where id=p_queue_id;
  v_count:=v_count+1;

  if v_q.match_id is not null then
    update public.decision_opportunity_queue q
    set queue_state='BLOCKED_CORRELATED',batch_no=null,updated_at=pg_catalog.now()
    from public.analysis_runs r
    where q.run_id=r.id
      and r.owner_id=p_owner_id
      and r.target_date is not distinct from v_target
      and q.match_id=v_q.match_id
      and q.id<>v_q.id
      and q.queue_state in ('AVAILABLE','SHOWN');
  end if;

  insert into public.experimental_bet_tracking(
    run_id,match_id,prediction_id,target_date,match_label,competition,market_family,market,market_label,
    participant,side,line_canonical,model_version,model_status,model_probability,fair_odd,entry_odd,min_odd_target,
    edge,expected_value,result,bet_status,selection_rank,decision_odd,decision_expected_value,decision_edge,
    decision_quote_captured_at,updated_at
  ) values(
    v_q.run_id,v_q.match_id,v_q.prediction_id,v_target,v_q.match_label,v_q.competition,v_q.market_family,v_q.market,
    v_q.market_label,v_q.participant,v_q.side,v_q.line_canonical,v_q.model_version,v_q.model_status,v_q.model_probability,
    v_q.fair_odd,v_q.entry_odd,v_q.min_odd_target,v_q.edge,v_q.expected_value,'PENDING','PROPOSED',v_count,
    v_q.entry_odd,v_q.expected_value,v_q.edge,v_q.created_at,pg_catalog.now()
  ) on conflict(run_id,prediction_id) do update set
    bet_status='PROPOSED',
    selection_rank=excluded.selection_rank,
    entry_odd=excluded.entry_odd,
    expected_value=excluded.expected_value,
    edge=excluded.edge,
    decision_odd=excluded.decision_odd,
    decision_expected_value=excluded.decision_expected_value,
    decision_edge=excluded.decision_edge,
    decision_quote_captured_at=excluded.decision_quote_captured_at,
    execution_quote_captured_at=null,
    execution_quote_source=null,
    updated_at=pg_catalog.now();

  select not exists(
    select 1 from public.decision_opportunity_queue
    where run_id=v_q.run_id and queue_state in ('AVAILABLE','SHOWN')
  ) into v_exhausted;

  if v_count>=3 or (v_count>0 and v_exhausted) then
    update public.analysis_runs
    set selection_finalized_at=pg_catalog.now(),updated_at=pg_catalog.now()
    where id=v_q.run_id;
    return query select true,v_count,true;
    return;
  end if;

  return query select true,v_count,false;
end;
$$;

revoke all on function public.accept_decision_opportunity_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.accept_decision_opportunity_atomic(uuid,uuid) to service_role;

-- Remove the legacy two-argument confirmation RPC so a positive stake cannot be
-- opened by reusing the decision-time price.
drop function if exists public.confirm_experimental_bet_atomic(uuid,numeric);

create function public.confirm_experimental_bet_atomic(
  p_id uuid,
  p_stake_brl numeric,
  p_entry_odd numeric,
  p_expected_value numeric,
  p_edge numeric,
  p_line_canonical numeric
)
returns table(
  status text,
  stake_brl numeric,
  available_after numeric,
  max_allowed numeric,
  minimum_stake numeric
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_initial numeric;
  v_max_pct numeric;
  v_min_stake numeric;
  v_tracking public.experimental_bet_tracking%rowtype;
  v_settled_profit numeric := 0;
  v_locked numeric := 0;
  v_equity numeric := 0;
  v_available numeric := 0;
  v_stake numeric := 0;
  v_max_allowed numeric := 0;
  v_now timestamptz := pg_catalog.now();
begin
  select c.initial_bankroll,c.max_stake_pct,c.min_stake_brl
    into v_initial,v_max_pct,v_min_stake
  from public.experimental_bankroll_config c
  where c.id='main'
  for update;
  if not found then raise exception 'Configuração da banca experimental ausente.'; end if;

  select t.* into v_tracking
  from public.experimental_bet_tracking t
  where t.id=p_id
  for update;
  if not found then raise exception 'Não foi possível localizar esta sugestão.'; end if;
  if v_tracking.bet_status<>'PROPOSED' then raise exception 'Esta sugestão já foi confirmada ou recusada.'; end if;

  select coalesce(sum(coalesce(t.profit_brl,0)),0) into v_settled_profit
  from public.experimental_bet_tracking t
  where t.bet_status='SETTLED' or t.result<>'PENDING';

  select coalesce(sum(coalesce(t.stake_brl,0)),0) into v_locked
  from public.experimental_bet_tracking t
  where t.bet_status='OPEN' and t.result='PENDING';

  v_equity:=coalesce(v_initial,0)+v_settled_profit;
  v_available:=greatest(0,v_equity-v_locked);
  v_stake:=greatest(0,floor(coalesce(p_stake_brl,0)*100+0.000000001)/100);

  if v_available>=v_min_stake and v_min_stake>0 then
    v_max_allowed:=least(
      v_available,
      greatest(v_min_stake,floor(v_available*v_max_pct*100+0.000000001)/100)
    );
  else
    v_max_allowed:=0;
  end if;

  if v_stake<=0 then
    update public.experimental_bet_tracking t
    set bet_status='DECLINED',stake_brl=0,declined_at=v_now,updated_at=v_now
    where t.id=p_id and t.bet_status='PROPOSED';
    if not found then raise exception 'Esta sugestão mudou de estado antes da recusa.'; end if;
    return query select 'DECLINED'::text,0::numeric,v_available,v_max_allowed,v_min_stake;
    return;
  end if;

  -- Defense in depth for the price revalidated by trusted server code.
  if p_entry_odd is null or p_entry_odd<1.70 then
    raise exception 'A odd atual precisa ser pelo menos 1,70.';
  end if;
  if p_expected_value is null or p_expected_value<0.08 then
    raise exception 'A cotação atual não mantém EV mínimo de 8%%.';
  end if;
  if p_edge is null or p_edge<0.05 then
    raise exception 'A cotação atual não mantém vantagem mínima de 5 p.p.';
  end if;
  if v_tracking.model_probability<0.70 or v_tracking.model_probability>1 then
    raise exception 'A probabilidade operacional não atende à régua mínima de 70%%.';
  end if;
  if p_line_canonical is distinct from v_tracking.line_canonical then
    raise exception 'A linha atual difere da linha modelada; recalcule a partida antes de apostar.';
  end if;

  if v_stake<v_min_stake then
    raise exception 'A aposta mínima operacional é R$ %.',pg_catalog.to_char(v_min_stake,'FM999999990D00');
  end if;
  if v_stake>v_available then
    raise exception 'O valor informado supera o saldo disponível de R$ %.',pg_catalog.to_char(v_available,'FM999999990D00');
  end if;
  if v_stake>v_max_allowed then
    raise exception 'O limite operacional desta aposta é R$ %.',pg_catalog.to_char(v_max_allowed,'FM999999990D00');
  end if;

  update public.experimental_bet_tracking t
  set decision_odd=coalesce(t.decision_odd,t.entry_odd),
      decision_expected_value=coalesce(t.decision_expected_value,t.expected_value),
      decision_edge=coalesce(t.decision_edge,t.edge),
      decision_quote_captured_at=coalesce(t.decision_quote_captured_at,t.created_at),
      entry_odd=p_entry_odd,
      expected_value=p_expected_value,
      edge=p_edge,
      execution_quote_captured_at=v_now,
      execution_quote_source='USER_CONFIRMED_BET365',
      bet_status='OPEN',
      stake_brl=v_stake,
      accepted_at=v_now,
      declined_at=null,
      updated_at=v_now
  where t.id=p_id and t.bet_status='PROPOSED';
  if not found then raise exception 'Esta sugestão mudou de estado antes da confirmação.'; end if;

  return query select
    'OPEN'::text,
    v_stake,
    greatest(0,v_available-v_stake),
    v_max_allowed,
    v_min_stake;
end;
$$;

revoke all on function public.confirm_experimental_bet_atomic(uuid,numeric,numeric,numeric,numeric,numeric)
  from public,anon,authenticated;
grant execute on function public.confirm_experimental_bet_atomic(uuid,numeric,numeric,numeric,numeric,numeric)
  to service_role;

comment on function public.confirm_experimental_bet_atomic(uuid,numeric,numeric,numeric,numeric,numeric) is
  'Abre stake positiva somente após nova cotação Bet365 confirmada e revalidada contra odd>=1.70, EV>=8%, edge>=5pp e linha modelada; preserva separadamente a cotação que originou a decisão.';

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260913-stage5-execution-quote-revalidation',
  'stage5_execution_quote_revalidation',
  'Preserves decision-time price/EV/edge and requires a newly confirmed Bet365 execution quote before positive stake; actual entry_odd becomes the price used by CLV.'
)
on conflict(version) do update
set migration_name=excluded.migration_name,
    notes=excluded.notes,
    applied_at=pg_catalog.now();
