-- Follow-up hardening for the backend/API funnel migration.

create or replace function public.enqueue_analysis_job_atomic(
  p_run_id uuid,
  p_user_id uuid
)
returns table(status text, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_inserted integer := 0;
begin
  if not exists (
    select 1 from public.analysis_runs r
    where r.id = p_run_id and r.owner_id = p_user_id
  ) then
    raise exception 'Análise não encontrada.';
  end if;

  insert into public.analysis_jobs(run_id, user_id, status)
  values (p_run_id, p_user_id, 'QUEUED')
  on conflict (run_id) do nothing;
  get diagnostics v_inserted = row_count;

  select j.status into v_status
  from public.analysis_jobs j
  where j.run_id = p_run_id and j.user_id = p_user_id;

  return query select v_status, (v_inserted = 1);
end;
$$;
revoke all on function public.enqueue_analysis_job_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_analysis_job_atomic(uuid,uuid) to service_role;

create or replace function public.sync_decision_queue_from_tracking()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if NEW.bet_status = 'DECLINED' and OLD.bet_status is distinct from 'DECLINED' then
    update public.decision_opportunity_queue
    set queue_state='DECLINED',updated_at=pg_catalog.now()
    where run_id=NEW.run_id and prediction_id=NEW.prediction_id and queue_state='ACCEPTED';
  end if;
  return NEW;
end;
$$;
revoke all on function public.sync_decision_queue_from_tracking() from public,anon,authenticated;
grant execute on function public.sync_decision_queue_from_tracking() to service_role;

drop trigger if exists trg_sync_decision_queue_from_tracking on public.experimental_bet_tracking;
create trigger trg_sync_decision_queue_from_tracking
after update of bet_status on public.experimental_bet_tracking
for each row execute function public.sync_decision_queue_from_tracking();

comment on function public.sync_decision_queue_from_tracking() is
  'When a selected bet is declined at stake confirmation, release the choice slot while preserving queue history.';
