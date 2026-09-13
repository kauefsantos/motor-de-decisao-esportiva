-- Once the value funnel has been evaluated, an empty queue is a legitimate
-- terminal result. Do not leave the run waiting for an impossible selection.

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
declare
  v_batch integer;
  v_finalized timestamptz;
begin
  if p_limit<1 or p_limit>10 then raise exception 'O lote deve conter entre 1 e 10 opções.'; end if;

  select r.selection_finalized_at into v_finalized
  from public.analysis_runs r
  where r.id=p_run_id and r.owner_id=p_owner_id
  for update;
  if not found then raise exception 'Análise não encontrada.'; end if;
  if v_finalized is not null then return; end if;

  if not exists(
    select 1 from public.decision_opportunity_queue q where q.run_id=p_run_id
  ) and exists(
    select 1 from public.pipeline_logs l
    where l.run_id=p_run_id and l.step='DECISION_QUEUE_EVALUATED'
  ) then
    update public.analysis_runs
    set selection_finalized_at=pg_catalog.now(),updated_at=pg_catalog.now()
    where id=p_run_id and owner_id=p_owner_id and selection_finalized_at is null;
    return;
  end if;

  if exists(
    select 1 from public.decision_opportunity_queue q
    where q.run_id=p_run_id and q.queue_state='SHOWN'
  ) then
    return query
    select * from public.decision_opportunity_queue q
    where q.run_id=p_run_id and q.queue_state='SHOWN'
    order by q.rank_global;
    return;
  end if;

  select coalesce(max(q.batch_no),0)+1 into v_batch
  from public.decision_opportunity_queue q
  where q.run_id=p_run_id;

  with candidates as (
    select
      z.id,
      z.rank_global,
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

  return query
  select * from public.decision_opportunity_queue q
  where q.run_id=p_run_id and q.queue_state='SHOWN'
  order by q.rank_global;
end;
$$;

revoke all on function public.next_decision_batch_atomic(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.next_decision_batch_atomic(uuid,uuid,integer) to service_role;

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260913-stage5-zero-queue-finalize',
  'stage5_zero_queue_finalize',
  'After DECISION_QUEUE_EVALUATED, next_decision_batch_atomic finalizes an empty queue as a valid zero-bet result instead of leaving the run pending.'
)
on conflict(version) do update
set migration_name=excluded.migration_name,
    notes=excluded.notes,
    applied_at=pg_catalog.now();
