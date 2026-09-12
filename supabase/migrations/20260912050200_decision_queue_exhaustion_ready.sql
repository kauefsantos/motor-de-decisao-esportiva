-- Up to three means fewer accepted choices may proceed when no qualified options remain.
create or replace function public.accept_decision_opportunity_atomic(
  p_queue_id uuid,
  p_owner_id uuid
)
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
begin
  select q.* into v_q
  from public.decision_opportunity_queue q
  join public.analysis_runs r on r.id=q.run_id
  where q.id=p_queue_id and r.owner_id=p_owner_id
  for update of q;
  if not found then raise exception 'Opção não encontrada.'; end if;

  select r.target_date into v_target from public.analysis_runs r where r.id=v_q.run_id for update;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text||':'||pg_catalog.coalesce(v_target::text,'sem-data'),0));
  select count(*) into v_count
  from public.decision_opportunity_queue q join public.analysis_runs r on r.id=q.run_id
  where r.owner_id=p_owner_id and r.target_date is not distinct from v_target and q.queue_state='ACCEPTED';
  if v_count>=3 then raise exception 'Limite diário de 3 escolhas atingido.'; end if;
  if v_q.queue_state<>'SHOWN' then
    select not exists(select 1 from public.decision_opportunity_queue where run_id=v_q.run_id and queue_state in ('AVAILABLE','SHOWN')) into v_exhausted;
    return query select false,v_count,(v_count>=3 or (v_count>0 and v_exhausted));
    return;
  end if;

  update public.decision_opportunity_queue set queue_state='ACCEPTED',updated_at=pg_catalog.now() where id=p_queue_id;
  v_count:=v_count+1;

  insert into public.experimental_bet_tracking(
    run_id,match_id,prediction_id,target_date,match_label,competition,market_family,market,market_label,
    participant,side,line_canonical,model_version,model_status,model_probability,fair_odd,entry_odd,
    min_odd_target,edge,expected_value,result,bet_status,selection_rank,updated_at
  ) values(
    v_q.run_id,v_q.match_id,v_q.prediction_id,v_target,v_q.match_label,v_q.competition,v_q.market_family,v_q.market,
    v_q.market_label,v_q.participant,v_q.side,v_q.line_canonical,v_q.model_version,v_q.model_status,v_q.model_probability,
    v_q.fair_odd,v_q.entry_odd,v_q.min_odd_target,v_q.edge,v_q.expected_value,'PENDING','PROPOSED',v_count,pg_catalog.now()
  ) on conflict(run_id,prediction_id) do update set
    bet_status='PROPOSED',selection_rank=excluded.selection_rank,updated_at=pg_catalog.now();

  select not exists(select 1 from public.decision_opportunity_queue where run_id=v_q.run_id and queue_state in ('AVAILABLE','SHOWN')) into v_exhausted;
  return query select true,v_count,(v_count>=3 or (v_count>0 and v_exhausted));
end;
$$;
revoke all on function public.accept_decision_opportunity_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.accept_decision_opportunity_atomic(uuid,uuid) to service_role;
