-- Stage 5 portfolio defense: the daily portfolio is 0..3 selections,
-- at most one per match and at most two from the same market family.

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
  v_family_count integer;
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

  select count(*) into v_family_count
  from public.decision_opportunity_queue q
  join public.analysis_runs r on r.id=q.run_id
  where r.owner_id=p_owner_id
    and r.target_date is not distinct from v_target
    and q.queue_state='ACCEPTED'
    and q.market_family=v_q.market_family;
  if v_family_count>=2 then
    raise exception 'Limite diário de 2 escolhas da mesma família atingido.';
  end if;

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

create or replace function public.decline_decision_opportunity_atomic(p_queue_id uuid, p_owner_id uuid)
returns table(declined boolean, exhausted boolean, accepted_count integer)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_run uuid;
  v_count integer;
  v_exhausted boolean;
  v_finalized timestamptz;
begin
  select q.run_id,r.selection_finalized_at into v_run,v_finalized
  from public.decision_opportunity_queue q
  join public.analysis_runs r on r.id=q.run_id
  where q.id=p_queue_id and r.owner_id=p_owner_id
  for update of q,r;
  if not found then raise exception 'Opção não encontrada.'; end if;
  if v_finalized is not null then raise exception 'A seleção desta análise já foi finalizada.'; end if;

  update public.decision_opportunity_queue
  set queue_state='DECLINED',updated_at=pg_catalog.now()
  where id=p_queue_id and queue_state='SHOWN';
  if not found then return query select false,false,0; return; end if;

  select count(*) into v_count
  from public.decision_opportunity_queue
  where run_id=v_run and queue_state='ACCEPTED';

  select not exists(
    select 1 from public.decision_opportunity_queue
    where run_id=v_run and queue_state in ('AVAILABLE','SHOWN')
  ) into v_exhausted;

  -- Zero selections is a valid terminal decision. When the queue is exhausted,
  -- persist completion even if nothing was accepted.
  if v_exhausted then
    update public.analysis_runs
    set selection_finalized_at=coalesce(selection_finalized_at,pg_catalog.now()),updated_at=pg_catalog.now()
    where id=v_run;
  end if;

  return query select true,v_exhausted,v_count;
end;
$$;

create or replace function public.finalize_decision_selection_atomic(p_run_id uuid, p_owner_id uuid)
returns table(finalized boolean, accepted_count integer)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count integer;
  v_target date;
  v_exhausted boolean;
begin
  select r.target_date into v_target
  from public.analysis_runs r
  where r.id=p_run_id and r.owner_id=p_owner_id
  for update;
  if not found then raise exception 'Análise não encontrada.'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_id::text||':'||coalesce(v_target::text,'sem-data'),0)
  );

  select count(*) into v_count
  from public.decision_opportunity_queue q
  where q.run_id=p_run_id and q.queue_state='ACCEPTED';
  if v_count>3 then raise exception 'O portfólio permite no máximo três apostas.'; end if;

  select not exists(
    select 1 from public.decision_opportunity_queue q
    where q.run_id=p_run_id and q.queue_state in ('AVAILABLE','SHOWN')
  ) into v_exhausted;
  if v_count<3 and not v_exhausted then
    raise exception 'Ainda existem opções para revisar antes de concluir a seleção.';
  end if;

  if exists(
    select q.market_family
    from public.decision_opportunity_queue q
    join public.analysis_runs r on r.id=q.run_id
    where r.owner_id=p_owner_id
      and r.target_date is not distinct from v_target
      and q.queue_state='ACCEPTED'
    group by q.market_family
    having count(*)>2
  ) then
    raise exception 'O portfólio permite no máximo duas escolhas da mesma família.';
  end if;

  update public.analysis_runs
  set selection_finalized_at=coalesce(selection_finalized_at,pg_catalog.now()),updated_at=pg_catalog.now()
  where id=p_run_id and owner_id=p_owner_id;

  return query select true,v_count;
end;
$$;

revoke all on function public.accept_decision_opportunity_atomic(uuid,uuid) from public,anon,authenticated;
revoke all on function public.decline_decision_opportunity_atomic(uuid,uuid) from public,anon,authenticated;
revoke all on function public.finalize_decision_selection_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.accept_decision_opportunity_atomic(uuid,uuid) to service_role;
grant execute on function public.decline_decision_opportunity_atomic(uuid,uuid) to service_role;
grant execute on function public.finalize_decision_selection_atomic(uuid,uuid) to service_role;

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260913-stage5-portfolio-zero-result-guard',
  'stage5_portfolio_zero_result_guard',
  'Enforces the daily max-two-per-family rule at acceptance/finalization and treats an exhausted zero-selection queue as a valid finalized decision.'
)
on conflict(version) do update
set migration_name=excluded.migration_name,
    notes=excluded.notes,
    applied_at=pg_catalog.now();
