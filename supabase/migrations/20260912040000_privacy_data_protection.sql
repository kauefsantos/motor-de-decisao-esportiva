-- Privacy and personal-data treatment hardening for the private single-user application.

create table if not exists public.privacy_processing_activities (
  activity_key text primary key,
  data_categories text[] not null,
  purpose text not null,
  lawful_basis text not null,
  storage_locations text[] not null,
  recipients text[] not null default '{}',
  retention_rule text not null,
  deletion_method text not null,
  active boolean not null default true,
  reviewed_at date not null default current_date
);

alter table public.privacy_processing_activities enable row level security;
revoke all on public.privacy_processing_activities from public, anon, authenticated;
grant select on public.privacy_processing_activities to service_role;

insert into public.privacy_processing_activities
(activity_key,data_categories,purpose,lawful_basis,storage_locations,recipients,retention_rule,deletion_method)
values
('google_identity',array['uuid','email','provider identifiers'],'Authenticate the single approved Google account and enforce ownership.','service_requested_and_security',array['auth.users','auth.identities'],array['Google','Lovable Cloud / Supabase'],'While the account is active. Removed with account deletion.','Supabase Admin user deletion plus database cleanup trigger.'),
('auth_session',array['session id','ip address','user agent','timestamps'],'Authenticate requests, prevent unauthorized access and enforce the absolute session lifetime.','security_and_fraud_prevention',array['auth.sessions'],array['Lovable Cloud / Supabase'],'30 days from session creation.','Daily retention cleanup; account deletion also cascades sessions.'),
('ownership',array['user uuid'],'Associate runs, jobs, bankroll settings and notification subscriptions with their owner.','service_requested',array['public.analysis_runs','public.analysis_jobs','public.experimental_bankroll_config','public.push_subscriptions'],array['Lovable Cloud / Supabase'],'While the account is active.','Account erasure removes owned application data.'),
('web_push',array['push endpoint','p256dh key','push auth secret','user agent'],'Notify the user that a background analysis finished.','user_requested_optional_feature',array['public.push_subscriptions'],array['Apple Push Service','Google FCM','Mozilla Push depending on device'],'Until disabled, provider invalidation, account deletion, or 90 days without subscription refresh.','Self-service disable, provider 404/410 cleanup and daily retention cleanup.'),
('upload_metadata',array['filename','csv headers'],'Describe an imported sports CSV without storing the original file object.','service_requested',array['public.uploaded_files'],array['Lovable Cloud / Supabase'],'While the owning analysis/account is retained.','Deleted by analysis-run cascade or account erasure.'),
('sports_history',array['analysis ownership','entered odds','bankroll and bet history'],'Provide decision history, bankroll calculations and analytics.','service_requested',array['public analysis and betting tables'],array['Lovable Cloud / Supabase'],'While the account is active.','Deleted by account erasure through analysis-run cascades and owner cleanup.'),
('error_telemetry',array['sanitized route','sanitized error message','sanitized stack'],'Diagnose application failures without intentionally exporting account identifiers or secrets.','security_and_service_reliability',array['runtime telemetry'],array['Lovable runtime telemetry when available'],'No raw personal identifiers are intentionally emitted; provider-side technical retention is governed by the platform.','Application redaction before reporting; no application database copy.'),
('governance_audit',array['actor uuid when available','change timestamp','before/after governed configuration'],'Maintain security and governance traceability.','security_audit_and_accountability',array['public.governance_change_log'],array['Lovable Cloud / Supabase'],'365 days.','Daily controlled retention cleanup; normal application paths remain append-only.')
on conflict (activity_key) do update set
  data_categories=excluded.data_categories,
  purpose=excluded.purpose,
  lawful_basis=excluded.lawful_basis,
  storage_locations=excluded.storage_locations,
  recipients=excluded.recipients,
  retention_rule=excluded.retention_rule,
  deletion_method=excluded.deletion_method,
  active=true,
  reviewed_at=current_date;

create table if not exists public.privacy_retention_policies (
  policy_key text primary key,
  target_scope text not null,
  retention_days integer check (retention_days is null or retention_days > 0),
  retention_basis text not null,
  deletion_action text not null,
  active boolean not null default true,
  reviewed_at date not null default current_date
);

alter table public.privacy_retention_policies enable row level security;
revoke all on public.privacy_retention_policies from public, anon, authenticated;
grant select on public.privacy_retention_policies to service_role;

insert into public.privacy_retention_policies
(policy_key,target_scope,retention_days,retention_basis,deletion_action)
values
('auth_sessions_30d','auth.sessions',30,'Absolute application session lifetime.','Delete expired session rows; refresh/MFA session children cascade.'),
('push_inactive_90d','public.push_subscriptions',90,'Optional endpoint is only needed while actively usable.','Delete subscriptions not refreshed for 90 days.'),
('governance_audit_365d','public.governance_change_log',365,'Security/accountability evidence with bounded retention.','Delete audit rows older than 365 days through the controlled retention function.'),
('account_history','owned analysis/betting data',null,'Core analytics history is useful while the private account is active.','Delete on account erasure via owner cleanup and run cascades.')
on conflict (policy_key) do update set
  target_scope=excluded.target_scope,
  retention_days=excluded.retention_days,
  retention_basis=excluded.retention_basis,
  deletion_action=excluded.deletion_action,
  active=true,
  reviewed_at=current_date;

-- Governance history stays immutable to application/service-role paths. The database-owner
-- retention function may remove only records whose configured retention has expired.
create or replace function public.reject_governance_log_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if TG_OP = 'DELETE'
     and current_user = 'postgres'
     and OLD.changed_at < now() - interval '365 days' then
    return OLD;
  end if;
  raise exception 'governance_change_log is append-only';
end;
$$;

create or replace function public.run_privacy_retention_cleanup()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_sessions integer := 0;
  v_push integer := 0;
  v_governance integer := 0;
begin
  delete from auth.sessions
   where created_at < now() - interval '30 days';
  get diagnostics v_sessions = row_count;

  delete from public.push_subscriptions
   where updated_at < now() - interval '90 days';
  get diagnostics v_push = row_count;

  delete from public.governance_change_log
   where changed_at < now() - interval '365 days';
  get diagnostics v_governance = row_count;

  return jsonb_build_object(
    'sessions_deleted', v_sessions,
    'push_deleted', v_push,
    'governance_deleted', v_governance,
    'executed_at', now()
  );
end;
$$;

revoke all on function public.run_privacy_retention_cleanup() from public, anon, authenticated;
grant execute on function public.run_privacy_retention_cleanup() to service_role;

create or replace function public.erase_user_application_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_push integer := 0;
  v_runs integer := 0;
  v_bankroll integer := 0;
begin
  if p_user_id is null then
    raise exception 'user id is required';
  end if;

  delete from public.push_subscriptions where user_id = p_user_id;
  get diagnostics v_push = row_count;

  delete from public.experimental_bankroll_config where owner_id = p_user_id;
  get diagnostics v_bankroll = row_count;

  delete from public.analysis_runs where owner_id = p_user_id;
  get diagnostics v_runs = row_count;

  -- Defensive cleanup for any job that could predate current FK/cascade guarantees.
  delete from public.analysis_jobs where user_id = p_user_id;

  return jsonb_build_object(
    'push_deleted', v_push,
    'runs_deleted', v_runs,
    'bankroll_deleted', v_bankroll
  );
end;
$$;

revoke all on function public.erase_user_application_data(uuid) from public, anon, authenticated;
grant execute on function public.erase_user_application_data(uuid) to service_role;

create or replace function private.cleanup_deleted_app_user()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  perform public.erase_user_application_data(OLD.id);
  update private.app_security_config
     set approved_user_id = null
   where singleton = true
     and approved_user_id = OLD.id;
  return OLD;
end;
$$;

revoke all on function private.cleanup_deleted_app_user() from public, anon, authenticated;
grant execute on function private.cleanup_deleted_app_user() to supabase_auth_admin;

drop trigger if exists cleanup_deleted_app_user on auth.users;
create trigger cleanup_deleted_app_user
after delete on auth.users
for each row execute function private.cleanup_deleted_app_user();

-- Minimize profile attributes not used by authorization. Email, provider and stable
-- identifiers remain; display name/avatar/picture are deliberately discarded.
create or replace function private.minimize_auth_user_metadata()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  NEW.raw_user_meta_data := coalesce(NEW.raw_user_meta_data, '{}'::jsonb)
    - 'avatar_url' - 'full_name' - 'name' - 'picture';
  return NEW;
end;
$$;

create or replace function private.minimize_identity_metadata()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  NEW.identity_data := coalesce(NEW.identity_data, '{}'::jsonb)
    - 'avatar_url' - 'full_name' - 'name' - 'picture';
  return NEW;
end;
$$;

revoke all on function private.minimize_auth_user_metadata() from public, anon, authenticated;
revoke all on function private.minimize_identity_metadata() from public, anon, authenticated;
grant execute on function private.minimize_auth_user_metadata() to supabase_auth_admin;
grant execute on function private.minimize_identity_metadata() to supabase_auth_admin;

drop trigger if exists minimize_auth_user_metadata on auth.users;
create trigger minimize_auth_user_metadata
before insert or update of raw_user_meta_data on auth.users
for each row execute function private.minimize_auth_user_metadata();

drop trigger if exists minimize_identity_metadata on auth.identities;
create trigger minimize_identity_metadata
before insert or update of identity_data on auth.identities
for each row execute function private.minimize_identity_metadata();

update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
  - 'avatar_url' - 'full_name' - 'name' - 'picture'
where coalesce(raw_user_meta_data, '{}'::jsonb) ?| array['avatar_url','full_name','name','picture'];

update auth.identities
set identity_data = coalesce(identity_data, '{}'::jsonb)
  - 'avatar_url' - 'full_name' - 'name' - 'picture'
where coalesce(identity_data, '{}'::jsonb) ?| array['avatar_url','full_name','name','picture'];

-- Run retention every day at 03:20 database time. Replacing by name keeps migration retries deterministic.
do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'privacy-retention-daily';
exception when undefined_table then
  null;
end $$;

select cron.schedule(
  'privacy-retention-daily',
  '20 3 * * *',
  'select public.run_privacy_retention_cleanup();'
);

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260912-privacy-data-protection',
  'privacy_data_protection',
  'Adds processing inventory, retention cleanup, account erasure cascade, OAuth metadata minimization and bounded privacy retention.'
)
on conflict (version) do update set
  migration_name=excluded.migration_name,
  notes=excluded.notes,
  applied_at=now();
