-- Make governance_change_log append-only for all normal application/database paths.

revoke update, delete, truncate on public.governance_change_log from service_role;

create or replace function public.reject_governance_log_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'governance_change_log is append-only';
end;
$$;

revoke all on function public.reject_governance_log_mutation() from public, anon, authenticated;

drop trigger if exists trg_governance_change_log_immutable on public.governance_change_log;
create trigger trg_governance_change_log_immutable
before update or delete on public.governance_change_log
for each row execute function public.reject_governance_log_mutation();

insert into public.app_schema_releases(version,migration_name,notes)
values('20260912-governance-log-append-only','governance_log_append_only','Revokes mutation privileges and rejects UPDATE/DELETE on governance change history.');
