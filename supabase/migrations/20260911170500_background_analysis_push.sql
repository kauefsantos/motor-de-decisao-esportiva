-- Background analysis queue + Web Push subscriptions.
-- The worker is dispatched by pg_net with a per-job random capability token.

create table if not exists public.analysis_jobs (
  run_id uuid primary key references public.analysis_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  dispatch_token uuid not null default gen_random_uuid(),
  status text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'DONE', 'ERROR')),
  current_step text,
  completed_steps text[] not null default '{}',
  attempts integer not null default 0,
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.analysis_jobs enable row level security;
revoke all on table public.analysis_jobs from public, anon, authenticated;
grant all on table public.analysis_jobs to service_role;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;
grant all on table public.push_subscriptions to service_role;

create policy "push_subscriptions_select_own"
  on public.push_subscriptions for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "push_subscriptions_insert_own"
  on public.push_subscriptions for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "push_subscriptions_update_own"
  on public.push_subscriptions for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "push_subscriptions_delete_own"
  on public.push_subscriptions for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.claim_analysis_job(
  p_run_id uuid,
  p_dispatch_token uuid
)
returns table (
  run_id uuid,
  user_id uuid,
  completed_steps text[],
  attempts integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.analysis_jobs j
  set status = 'RUNNING',
      attempts = j.attempts + 1,
      locked_at = now(),
      last_error = null,
      updated_at = now()
  where j.run_id = p_run_id
    and j.dispatch_token = p_dispatch_token
    and (
      j.status = 'QUEUED'
      or (j.status = 'RUNNING' and j.locked_at < now() - interval '20 minutes')
    )
  returning j.run_id, j.user_id, j.completed_steps, j.attempts;
end;
$$;

revoke all on function public.claim_analysis_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_analysis_job(uuid, uuid) to service_role;

create or replace function public.kick_analysis_worker()
returns bigint
language plpgsql
security definer
set search_path = public, net, pg_temp
as $$
declare
  next_run_id uuid;
  next_dispatch_token uuid;
  request_id bigint;
begin
  select j.run_id, j.dispatch_token
    into next_run_id, next_dispatch_token
  from public.analysis_jobs j
  where j.status = 'QUEUED'
     or (j.status = 'RUNNING' and j.locked_at < now() - interval '20 minutes')
  order by j.created_at
  limit 1;

  if next_run_id is null then
    return null;
  end if;

  select net.http_post(
    url := 'https://quant-football-insights.lovable.app/api/analysis-worker',
    body := jsonb_build_object(
      'runId', next_run_id,
      'dispatchToken', next_dispatch_token
    ),
    params := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 600000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.kick_analysis_worker() from public, anon, authenticated;
grant execute on function public.kick_analysis_worker() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'analysis-worker-watch') then
    perform cron.unschedule('analysis-worker-watch');
  end if;
end
$$;

select cron.schedule(
  'analysis-worker-watch',
  '* * * * *',
  'select public.kick_analysis_worker();'
);
