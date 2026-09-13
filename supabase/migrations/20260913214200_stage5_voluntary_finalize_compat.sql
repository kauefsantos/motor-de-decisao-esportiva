-- Stage 5 compatibility: 0..3 means the user may deliberately stop with
-- one or two accepted selections. Zero remains fail-safe: it may only be
-- finalized when no AVAILABLE/SHOWN qualified opportunity remains.

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

  -- A deliberate stop with 1 or 2 choices is valid. Zero is only terminal
  -- after the qualified queue is exhausted, so "zero apostas" cannot be used
  -- to bypass opportunities that are still waiting for review.
  if v_count=0 and not v_exhausted then
    raise exception 'Ainda existem opções para revisar antes de concluir sem apostas.';
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

revoke all on function public.finalize_decision_selection_atomic(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.finalize_decision_selection_atomic(uuid,uuid)
  to service_role;

comment on function public.finalize_decision_selection_atomic(uuid,uuid) is
  'Finaliza 1..3 escolhas voluntariamente; zero somente quando a fila qualificada foi esgotada. Mantém máximo 2 por família e serialização por usuário/data.';

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260913-stage5-voluntary-finalize-compat',
  'stage5_voluntary_finalize_compat',
  'Restores voluntary finalization with one or two accepted choices while preserving fail-safe zero finalization only after the qualified queue is exhausted.'
)
on conflict(version) do update
set migration_name=excluded.migration_name,
    notes=excluded.notes,
    applied_at=pg_catalog.now();