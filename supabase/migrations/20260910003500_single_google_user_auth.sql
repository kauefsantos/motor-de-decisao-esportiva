-- Restrict Supabase Auth at the database boundary to one Google account.
-- This complements the server middleware and prevents creation/update of any
-- auth.users row that does not match the approved email + provider.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

drop trigger if exists enforce_single_google_user on auth.users;
drop function if exists private.enforce_single_google_user();

create function private.enforce_single_google_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
  v_provider text := coalesce(new.raw_app_meta_data ->> 'provider', '');
begin
  if v_email <> 'kauefsantos3@gmail.com' or v_provider <> 'google' then
    raise exception using
      errcode = '42501',
      message = 'Account not authorized for this application';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_single_google_user() from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.enforce_single_google_user() to supabase_auth_admin;

create trigger enforce_single_google_user
before insert or update of email, raw_app_meta_data
on auth.users
for each row
execute function private.enforce_single_google_user();
