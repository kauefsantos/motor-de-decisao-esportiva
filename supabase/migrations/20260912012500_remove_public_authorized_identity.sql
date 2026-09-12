-- Remove any privileged account identifier from the application source while
-- preserving the existing single-user Google boundary.
--
-- The first Google identity already present in auth.users is the canonical owner.
-- The browser/backend only receives a boolean answer about the current JWT.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.approved_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  where coalesce(u.raw_app_meta_data ->> 'provider', '') = 'google'
  order by u.created_at, u.id
  limit 1;
$$;

revoke all on function private.approved_app_user_id() from public, anon, authenticated;
grant execute on function private.approved_app_user_id() to service_role;

create or replace function private.enforce_single_google_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider text := coalesce(NEW.raw_app_meta_data ->> 'provider', '');
  v_approved_user_id uuid := private.approved_app_user_id();
begin
  if v_provider <> 'google'
     or (v_approved_user_id is not null and NEW.id is distinct from v_approved_user_id) then
    raise exception using
      errcode = '42501',
      message = 'Account not authorized for this application';
  end if;

  return NEW;
end
$function$;

revoke all on function private.enforce_single_google_user()
  from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.enforce_single_google_user()
  to supabase_auth_admin;

drop trigger if exists enforce_single_google_user on auth.users;
create trigger enforce_single_google_user
before insert or update of email, raw_app_meta_data
on auth.users
for each row
execute function private.enforce_single_google_user();

create or replace function public.is_approved_app_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and auth.uid() = private.approved_app_user_id()
     and exists (
       select 1
       from auth.users u
       where u.id = auth.uid()
         and coalesce(u.raw_app_meta_data ->> 'provider', '') = 'google'
     );
$$;

revoke all on function public.is_approved_app_user() from public, anon;
grant execute on function public.is_approved_app_user() to authenticated, service_role;
