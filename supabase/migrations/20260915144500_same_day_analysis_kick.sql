create or replace function public.kick_same_day_analysis(
  p_after_local_time text default '13:00'
)
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_token uuid;
  v_request bigint;
begin
  if p_after_local_time !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Horário mínimo inválido.';
  end if;

  select dispatch_token into v_token
  from private.external_api_maintenance_config
  where singleton=true;

  if v_token is null then
    return null;
  end if;

  select net.http_post(
    url := 'https://quant-football-insights.lovable.app/api/five-dollar-maintenance',
    body := pg_catalog.jsonb_build_object(
      'dispatchToken', v_token,
      'action', 'SAME_DAY_ANALYSIS',
      'afterLocalTime', p_after_local_time
    ),
    params := '{}'::jsonb,
    headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 120000
  ) into v_request;

  insert into public.automation_runs(job_name, request_id, metadata)
  values(
    'manual-same-day-analysis',
    v_request,
    pg_catalog.jsonb_build_object(
      'targetDate', (pg_catalog.now() at time zone 'America/Sao_Paulo')::date::text,
      'afterLocalTime', p_after_local_time,
      'localZone', 'America/Sao_Paulo'
    )
  )
  on conflict do nothing;

  return v_request;
end;
$function$;

revoke all on function public.kick_same_day_analysis(text) from public, anon, authenticated;
grant execute on function public.kick_same_day_analysis(text) to service_role;
