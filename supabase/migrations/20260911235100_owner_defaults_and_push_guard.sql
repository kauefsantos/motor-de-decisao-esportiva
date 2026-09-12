-- Compatibility while the live runtime rolls from the former single-user code
-- to explicit owner_id writes. New code sends owner_id directly; the default reads
-- the immutable approved identity from the private security configuration.
create or replace function private.approved_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.approved_user_id
  from private.app_security_config c
  where c.singleton = true;
$$;

revoke all on function private.approved_app_user_id() from public, anon, authenticated;
grant execute on function private.approved_app_user_id() to service_role;

alter table public.analysis_runs
  alter column owner_id set default private.approved_app_user_id();

alter table public.experimental_bankroll_config
  alter column owner_id set default private.approved_app_user_id();

-- A Web Push endpoint is a globally unique browser capability. Never allow an
-- upsert executed with service_role to transfer an existing endpoint to another
-- account merely by changing user_id.
create or replace function private.prevent_push_endpoint_owner_transfer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.user_id is distinct from new.user_id then
    raise exception using
      errcode = '42501',
      message = 'push endpoint ownership cannot be transferred';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_push_endpoint_owner_transfer() from public, anon, authenticated;

drop trigger if exists prevent_push_endpoint_owner_transfer on public.push_subscriptions;
create trigger prevent_push_endpoint_owner_transfer
before update of user_id on public.push_subscriptions
for each row execute function private.prevent_push_endpoint_owner_transfer();
