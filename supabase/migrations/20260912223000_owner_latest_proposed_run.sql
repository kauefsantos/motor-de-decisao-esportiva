-- Owner-scoped helper for the Home "Sugestões para registrar" shortcut.
-- Keeps tracking-table scans inside Lovable Cloud instead of application code.

create or replace function public.get_owner_latest_proposed_run_id(p_owner_id uuid)
returns uuid
language sql
stable
security definer
set search_path=''
as $$
  select t.run_id
  from public.experimental_bet_tracking t
  join public.analysis_runs r on r.id=t.run_id
  where r.owner_id=p_owner_id
    and t.bet_status='PROPOSED'
  order by t.updated_at desc, t.created_at desc, t.run_id desc
  limit 1;
$$;

revoke all on function public.get_owner_latest_proposed_run_id(uuid) from public, anon, authenticated;
grant execute on function public.get_owner_latest_proposed_run_id(uuid) to service_role;

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260912-owner-latest-proposed-run',
  'owner_latest_proposed_run',
  'Adds a server-only owner-scoped helper used by the Home to navigate directly to the latest proposed run without loading tracking rows in application code.'
)
on conflict (version) do update set
  migration_name=excluded.migration_name,
  notes=excluded.notes,
  applied_at=now();
