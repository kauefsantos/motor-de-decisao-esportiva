-- Stage 1 operational reconciliation.
-- A RUNNING analysis without a corresponding analysis_job cannot make progress.
-- Mark only stale orphan runs as ERROR, preserving the last step for forensics.

create or replace function public.reconcile_orphan_analysis_runs(p_stale_minutes integer default 30)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count integer := 0;
begin
  if p_stale_minutes < 5 or p_stale_minutes > 10080 then
    raise exception 'Janela de reconciliação inválida.';
  end if;

  update public.analysis_runs r
  set status='ERROR',
      notes=coalesce(r.notes,'{}'::jsonb) || pg_catalog.jsonb_build_object(
        'orphan_reconciled_at',pg_catalog.now(),
        'orphan_reconcile_reason','RUNNING_WITHOUT_JOB',
        'orphan_previous_step',r.current_step
      ),
      updated_at=pg_catalog.now()
  where r.status='RUNNING'
    and r.updated_at < pg_catalog.now() - pg_catalog.make_interval(mins=>p_stale_minutes)
    and not exists(
      select 1
      from public.analysis_jobs j
      where j.run_id=r.id
    );

  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.reconcile_orphan_analysis_runs(integer) from public,anon,authenticated;
grant execute on function public.reconcile_orphan_analysis_runs(integer) to service_role;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname='analysis-run-orphan-reconcile';
exception when undefined_table then
  null;
end $$;

select cron.schedule(
  'analysis-run-orphan-reconcile',
  '*/15 * * * *',
  'select public.reconcile_orphan_analysis_runs(30);'
);

-- Clean up existing stale legacy runs at migration time using the same guarded rule.
do $$
begin
  perform public.reconcile_orphan_analysis_runs(30);
end $$;

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260913-orphan-analysis-run-reconciliation',
  'orphan_analysis_run_reconciliation',
  'Marks stale RUNNING analysis_runs without an analysis_job as ERROR after 30 minutes, preserves forensic step metadata, and reconciles every 15 minutes.'
)
on conflict(version) do update
set migration_name=excluded.migration_name,
    notes=excluded.notes,
    applied_at=pg_catalog.now();