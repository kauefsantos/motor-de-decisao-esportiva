-- Integration/automation audit remediation.
-- 1) "up to three" means the user may deliberately finish with 1-3 choices.
-- 2) correlated markets are deferred, not destroyed; accepting one blocks peers.
-- 3) declining at stake re-opens qualified same-match alternatives.
-- 4) FiveDollar prewarm runs four bounded passes, 15 minutes apart.

alter table public.analysis_runs
  add column if not exists selection_finalized_at timestamptz;

alter table public.decision_opportunity_queue
  drop constraint if exists decision_opportunity_queue_queue_state_check;
alter table public.decision_opportunity_queue
  add constraint decision_opportunity_queue_queue_state_check
  check(queue_state in ('AVAILABLE','SHOWN','ACCEPTED','DECLINED','BLOCKED_CORRELATED'));

create or replace function public.replace_decision_queue_atomic(
  p_run_id uuid,
  p_owner_id uuid,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare v_count integer;
begin
  perform 1 from public.analysis_runs r where r.id=p_run_id and r.owner_id=p_owner_id for update;
  if not found then raise exception 'Análise não encontrada.'; end if;
  if exists(select 1 from public.decision_opportunity_queue q where q.run_id=p_run_id and q.queue_state='ACCEPTED') then
    raise exception 'A fila não pode ser reconstruída após uma escolha do usuário.';
  end if;

  delete from public.decision_opportunity_queue where run_id=p_run_id;
  update public.analysis_runs set selection_finalized_at=null,updated_at=pg_catalog.now()
    where id=p_run_id and owner_id=p_owner_id;

  insert into public.decision_opportunity_queue(
    run_id,match_id,prediction_id,rank_global,match_label,competition,market_family,market,market_label,
    participant,side,line_canonical,model_version,model_status,model_probability,fair_odd,entry_odd,min_odd_target,edge,expected_value
  )
  select p_run_id,x.match_id,x.prediction_id,x.rank_global,x.match_label,x.competition,x.market_family,x.market,x.market_label,
         x.participant,x.side,x.line_canonical,x.model_version,x.model_status,x.model_probability,x.fair_odd,x.entry_odd,
         x.min_odd_target,x.edge,x.expected_value
  from pg_catalog.jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) as x(
    match_id uuid,prediction_id text,rank_global integer,match_label text,competition text,market_family text,market text,
    market_label text,participant text,side text,line_canonical numeric,model_version text,model_status text,
    model_probability numeric,fair_odd numeric,entry_odd numeric,min_odd_target numeric,edge numeric,expected_value numeric
  );
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;
revoke all on function public.replace_decision_queue_atomic(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.replace_decision_queue_atomic(uuid,uuid,jsonb) to service_role;

create or replace function public.next_decision_batch_atomic(
  p_run_id uuid,
  p_owner_id uuid,
  p_limit integer default 10
)
returns setof public.decision_opportunity_queue
language plpgsql
security definer
set search_path=''
as $$
declare v_batch integer; v_finalized timestamptz;
begin
  if p_limit<1 or p_limit>10 then raise exception 'O lote deve conter entre 1 e 10 opções.'; end if;
  select r.selection_finalized_at into v_finalized
    from public.analysis_runs r where r.id=p_run_id and r.owner_id=p_owner_id for update;
  if not found then raise exception 'Análise não encontrada.'; end if;
  if v_finalized is not null then return; end if;

  if exists(select 1 from public.decision_opportunity_queue q where q.run_id=p_run_id and q.queue_state='SHOWN') then
    return query select * from public.decision_opportunity_queue q
      where q.run_id=p_run_id and q.queue_state='SHOWN' order by q.rank_global;
    return;
  end if;

  select coalesce(max(q.batch_no),0)+1 into v_batch
    from public.decision_opportunity_queue q where q.run_id=p_run_id;

  with candidates as (
    select z.id,z.rank_global,
           row_number() over(partition by coalesce(z.match_id,z.id) order by z.rank_global) as match_rank
    from public.decision_opportunity_queue z
    where z.run_id=p_run_id
      and z.queue_state='AVAILABLE'
      and not exists(
        select 1 from public.decision_opportunity_queue accepted
        where accepted.run_id=z.run_id
          and accepted.match_id is not distinct from z.match_id
          and accepted.queue_state='ACCEPTED'
      )
  ), picked as (
    select id from candidates where match_rank=1 order by rank_global limit p_limit
  )
  update public.decision_opportunity_queue q
     set queue_state='SHOWN',batch_no=v_batch,updated_at=pg_catalog.now()
   where q.id in (select id from picked);

  return query select * from public.decision_opportunity_queue q
    where q.run_id=p_run_id and q.queue_state='SHOWN' order by q.rank_global;
end;
$$;
revoke all on function public.next_decision_batch_atomic(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.next_decision_batch_atomic(uuid,uuid,integer) to service_role;

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
    select 1 from public.decision_opportunity_queue q
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
    participant,side,line_canonical,model_version,model_status,model_probability,fair_odd,entry_odd,
    min_odd_target,edge,expected_value,result,bet_status,selection_rank,updated_at
  ) values(
    v_q.run_id,v_q.match_id,v_q.prediction_id,v_target,v_q.match_label,v_q.competition,v_q.market_family,v_q.market,
    v_q.market_label,v_q.participant,v_q.side,v_q.line_canonical,v_q.model_version,v_q.model_status,v_q.model_probability,
    v_q.fair_odd,v_q.entry_odd,v_q.min_odd_target,v_q.edge,v_q.expected_value,'PENDING','PROPOSED',v_count,pg_catalog.now()
  ) on conflict(run_id,prediction_id) do update set
    bet_status='PROPOSED',selection_rank=excluded.selection_rank,updated_at=pg_catalog.now();

  select not exists(
    select 1 from public.decision_opportunity_queue
    where run_id=v_q.run_id and queue_state in ('AVAILABLE','SHOWN')
  ) into v_exhausted;

  if v_count>=3 or (v_count>0 and v_exhausted) then
    update public.analysis_runs set selection_finalized_at=pg_catalog.now(),updated_at=pg_catalog.now()
      where id=v_q.run_id;
    return query select true,v_count,true;
  end if;

  return query select true,v_count,false;
end;
$$;
revoke all on function public.accept_decision_opportunity_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.accept_decision_opportunity_atomic(uuid,uuid) to service_role;

create or replace function public.decline_decision_opportunity_atomic(
  p_queue_id uuid,
  p_owner_id uuid
)
returns table(declined boolean, exhausted boolean, accepted_count integer)
language plpgsql
security definer
set search_path=''
as $$
declare v_run uuid; v_count integer; v_exhausted boolean; v_finalized timestamptz;
begin
  select q.run_id,r.selection_finalized_at into v_run,v_finalized
  from public.decision_opportunity_queue q join public.analysis_runs r on r.id=q.run_id
  where q.id=p_queue_id and r.owner_id=p_owner_id for update of q,r;
  if not found then raise exception 'Opção não encontrada.'; end if;
  if v_finalized is not null then raise exception 'A seleção desta análise já foi finalizada.'; end if;

  update public.decision_opportunity_queue set queue_state='DECLINED',updated_at=pg_catalog.now()
    where id=p_queue_id and queue_state='SHOWN';
  if not found then return query select false,false,0; return; end if;

  select count(*) into v_count from public.decision_opportunity_queue
    where run_id=v_run and queue_state='ACCEPTED';
  select not exists(select 1 from public.decision_opportunity_queue
    where run_id=v_run and queue_state in ('AVAILABLE','SHOWN')) into v_exhausted;

  if v_exhausted and v_count>0 then
    update public.analysis_runs set selection_finalized_at=pg_catalog.now(),updated_at=pg_catalog.now()
      where id=v_run;
  end if;
  return query select true,v_exhausted,v_count;
end;
$$;
revoke all on function public.decline_decision_opportunity_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.decline_decision_opportunity_atomic(uuid,uuid) to service_role;

create or replace function public.finalize_decision_selection_atomic(
  p_run_id uuid,
  p_owner_id uuid
)
returns table(finalized boolean, accepted_count integer)
language plpgsql
security definer
set search_path=''
as $$
declare v_count integer; v_target date;
begin
  select r.target_date into v_target from public.analysis_runs r
    where r.id=p_run_id and r.owner_id=p_owner_id for update;
  if not found then raise exception 'Análise não encontrada.'; end if;

  select count(*) into v_count from public.decision_opportunity_queue q
    where q.run_id=p_run_id and q.queue_state='ACCEPTED';
  if v_count<1 or v_count>3 then
    raise exception 'Escolha ao menos uma e no máximo três apostas antes de continuar.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_id::text||':'||coalesce(v_target::text,'sem-data'),0)
  );
  update public.analysis_runs set selection_finalized_at=coalesce(selection_finalized_at,pg_catalog.now()),updated_at=pg_catalog.now()
    where id=p_run_id and owner_id=p_owner_id;
  return query select true,v_count;
end;
$$;
revoke all on function public.finalize_decision_selection_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finalize_decision_selection_atomic(uuid,uuid) to service_role;

create or replace function public.sync_decision_queue_from_tracking()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_match uuid; v_owner uuid; v_target date;
begin
  if NEW.bet_status='DECLINED' and OLD.bet_status is distinct from 'DECLINED' then
    select q.match_id,r.owner_id,r.target_date into v_match,v_owner,v_target
      from public.decision_opportunity_queue q
      join public.analysis_runs r on r.id=q.run_id
     where q.run_id=NEW.run_id and q.prediction_id=NEW.prediction_id
     limit 1;

    update public.decision_opportunity_queue set queue_state='DECLINED',updated_at=pg_catalog.now()
      where run_id=NEW.run_id and prediction_id=NEW.prediction_id and queue_state='ACCEPTED';

    if v_match is not null and not exists(
      select 1 from public.decision_opportunity_queue q
      join public.analysis_runs r on r.id=q.run_id
      where r.owner_id=v_owner and r.target_date is not distinct from v_target
        and q.match_id=v_match and q.queue_state='ACCEPTED'
    ) then
      update public.decision_opportunity_queue q
         set queue_state='AVAILABLE',batch_no=null,updated_at=pg_catalog.now()
        from public.analysis_runs r
       where q.run_id=r.id
         and r.owner_id=v_owner and r.target_date is not distinct from v_target
         and q.match_id=v_match and q.queue_state='BLOCKED_CORRELATED';
    end if;

    update public.analysis_runs set selection_finalized_at=null,updated_at=pg_catalog.now()
      where id=NEW.run_id;
  end if;
  return NEW;
end;
$$;
revoke all on function public.sync_decision_queue_from_tracking() from public,anon,authenticated;
grant execute on function public.sync_decision_queue_from_tracking() to service_role;

-- The maintenance pass intentionally spends at most 7 calls. Four passes spaced
-- 15 minutes apart can cover up to 12 leagues/day while each pass remains under
-- the 9/min operational cap and transient failures get later retries.
do $$ begin
  if exists(select 1 from cron.job where jobname='five-dollar-maintenance-daily') then
    perform cron.unschedule('five-dollar-maintenance-daily');
  end if;
end $$;
select cron.schedule(
  'five-dollar-maintenance-daily',
  '10,25,40,55 6 * * *',
  'select public.kick_external_api_maintenance();'
);
