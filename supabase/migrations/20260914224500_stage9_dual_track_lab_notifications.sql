-- Dual-track operating model:
-- 1) the experimental decision flow remains available for entertainment/tracking;
-- 2) Stage 9 validates calibration independently and can never block that flow;
-- 3) Lovable Cloud stores a small owner-scoped event feed so the UI can explain
--    what the laboratory is doing without exposing private validation tables.

create table if not exists private.model_lab_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  stage text not null default 'STAGE9',
  event_type text not null,
  severity text not null default 'INFO' check (severity in ('INFO','SUCCESS','WARNING','ERROR')),
  title text not null,
  message text not null,
  model_version text,
  candidate_version text,
  job_id uuid references private.model_validation_jobs(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  created_at timestamptz not null default pg_catalog.now(),
  read_at timestamptz
);

create index if not exists idx_model_lab_events_owner_created
  on private.model_lab_events(owner_id,created_at desc);
create index if not exists idx_model_lab_events_owner_unread
  on private.model_lab_events(owner_id,created_at desc)
  where read_at is null;

revoke all on table private.model_lab_events from public,anon,authenticated;
grant select,insert,update on table private.model_lab_events to service_role;

create or replace function private.stage9_model_lab_owner()
returns uuid
language sql
stable
security definer
set search_path=''
as $$
  select pg_catalog.coalesce(
    (
      select c.owner_id
      from private.scheduled_analysis_config c
      where c.singleton=true
      limit 1
    ),
    (
      select b.owner_id
      from public.experimental_bankroll_config b
      where b.id='main' and b.owner_id is not null
      limit 1
    )
  )
$$;

revoke all on function private.stage9_model_lab_owner() from public,anon,authenticated;
grant execute on function private.stage9_model_lab_owner() to service_role;

create or replace function private.emit_stage9_model_lab_event(
  p_event_type text,
  p_severity text,
  p_title text,
  p_message text,
  p_dedupe_key text,
  p_job_id uuid default null,
  p_candidate_version text default null,
  p_payload jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid;
  v_inserted integer:=0;
begin
  v_owner:=private.stage9_model_lab_owner();
  if v_owner is null then return false; end if;
  if p_severity not in ('INFO','SUCCESS','WARNING','ERROR') then
    raise exception 'Invalid model-lab event severity.';
  end if;
  if pg_catalog.btrim(pg_catalog.coalesce(p_dedupe_key,''))='' then
    raise exception 'Model-lab event requires a dedupe key.';
  end if;

  insert into private.model_lab_events(
    owner_id,stage,event_type,severity,title,message,model_version,candidate_version,job_id,payload,dedupe_key
  ) values(
    v_owner,'STAGE9',p_event_type,p_severity,
    pg_catalog.left(p_title,180),pg_catalog.left(p_message,900),
    'goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040',
    p_candidate_version,p_job_id,coalesce(p_payload,'{}'::jsonb),p_dedupe_key
  )
  on conflict(dedupe_key) do nothing;
  get diagnostics v_inserted=row_count;
  return v_inserted=1;
end;
$$;

revoke all on function private.emit_stage9_model_lab_event(text,text,text,text,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.emit_stage9_model_lab_event(text,text,text,text,text,uuid,text,jsonb) to service_role;

create or replace function public.get_model_lab_events(
  p_owner_id uuid,
  p_limit integer default 8
)
returns table(
  id uuid,
  stage text,
  event_type text,
  severity text,
  title text,
  message text,
  model_version text,
  candidate_version text,
  payload jsonb,
  created_at timestamptz,
  read_at timestamptz
)
language sql
stable
security definer
set search_path=''
as $$
  select
    e.id,e.stage,e.event_type,e.severity,e.title,e.message,
    e.model_version,e.candidate_version,e.payload,e.created_at,e.read_at
  from private.model_lab_events e
  where e.owner_id=p_owner_id
  order by e.created_at desc
  limit greatest(1,least(coalesce(p_limit,8),20))
$$;

revoke all on function public.get_model_lab_events(uuid,integer) from public,anon,authenticated;
grant execute on function public.get_model_lab_events(uuid,integer) to service_role;

create or replace function public.mark_model_lab_events_read(p_owner_id uuid)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare v_changed integer:=0;
begin
  update private.model_lab_events e
     set read_at=pg_catalog.now()
   where e.owner_id=p_owner_id
     and e.read_at is null;
  get diagnostics v_changed=row_count;
  return v_changed;
end;
$$;

revoke all on function public.mark_model_lab_events_read(uuid) from public,anon,authenticated;
grant execute on function public.mark_model_lab_events_read(uuid) to service_role;

-- Turn generic Stage 9 validation-job lifecycle changes into concise user-facing
-- notifications. We intentionally do not create one event per candidate: the
-- calibration job can test dozens of candidates, while the user sees only
-- meaningful start/result/progress transitions.
create or replace function private.notify_stage9_validation_job()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_is_calibration boolean;
  v_is_holdout boolean;
  v_readiness text;
  v_selected text;
  v_sample integer;
  v_validation text;
  v_gap numeric;
begin
  v_is_calibration:=new.protocol_version='stage9-1x2-ensemble-calibration-v1';
  v_is_holdout:=new.protocol_version='stage9-1x2-ensemble-prospective-holdout-v1';
  if not v_is_calibration and not v_is_holdout then return new; end if;

  if tg_op='UPDATE' and new.status='RUNNING' and old.status is distinct from 'RUNNING' then
    perform private.emit_stage9_model_lab_event(
      case when v_is_calibration then 'CALIBRATION_STARTED' else 'HOLDOUT_STARTED' end,
      'INFO',
      case when v_is_calibration then 'Stage 9 está testando calibração' else 'Stage 9 está atualizando o teste diário' end,
      case when v_is_calibration
        then 'Estou comparando as alternativas de calibração sem alterar o uncertainty-linear 40% usado no modo diversão.'
        else 'Estou incorporando os novos resultados disponíveis ao teste prospectivo. O modo diversão continua funcionando em paralelo.'
      end,
      'stage9-job:'||new.id::text||':running',
      new.id,new.target_calibration_version,
      pg_catalog.jsonb_build_object('protocolVersion',new.protocol_version)
    );
  end if;

  if tg_op='UPDATE' and new.status='DONE' and old.status is distinct from 'DONE' then
    v_readiness:=pg_catalog.coalesce(new.report->>'readinessStatus','');
    v_selected:=new.report#>>'{selection,selected,id}';
    if v_is_calibration then
      v_gap:=nullif(new.report#>>'{retrospective,calibratedMetrics,maxCalibrationGap}','')::numeric;
      perform private.emit_stage9_model_lab_event(
        'CALIBRATION_RESULT',
        case when v_readiness='SHADOW_READY' then 'SUCCESS' else 'WARNING' end,
        case when v_readiness='SHADOW_READY'
          then 'Stage 9 encontrou um calibrador para shadow'
          else 'Stage 9 concluiu uma rodada de testes'
        end,
        case when v_readiness='SHADOW_READY'
          then 'O candidato passou os gates retrospectivos e entrou em observação. Ele ainda não substitui nem bloqueia o modo diversão.'
          else 'Nenhum candidato desta rodada ficou apto para promoção. O modo diversão segue igual enquanto o laboratório procura uma melhora segura.'
        end,
        'stage9-job:'||new.id::text||':done',
        new.id,pg_catalog.coalesce(v_selected,new.target_calibration_version),
        pg_catalog.jsonb_build_object(
          'readinessStatus',v_readiness,
          'selectedCandidate',v_selected,
          'maxCalibrationGap',v_gap,
          'candidateCount',new.report#>'{selection,candidateCount}'
        )
      );
    else
      v_sample:=pg_catalog.coalesce(nullif(new.report#>>'{prospectiveHoldout,sampleSize}','')::integer,0);
      select mv.validation_status into v_validation
      from public.model_versions mv
      where mv.market_family='1X2'
        and mv.model_version='goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040'
        and mv.calibration_version='stage9-ensemble-calibration-v1-fit-through-2026-05-31'
      order by mv.created_at desc
      limit 1;

      perform private.emit_stage9_model_lab_event(
        case when v_validation='PRODUCTION_VALIDATED' then 'MODEL_VALIDATED' else 'HOLDOUT_PROGRESS' end,
        case when v_validation='PRODUCTION_VALIDATED' then 'SUCCESS'
             when v_readiness='HOLDOUT_FAILED' then 'WARNING'
             else 'INFO' end,
        case when v_validation='PRODUCTION_VALIDATED' then 'Stage 9 validou o modelo para produção'
             when v_readiness='HOLDOUT_FAILED' then 'Stage 9 encontrou um problema no holdout'
             else 'Stage 9 atualizou o teste prospectivo' end,
        case when v_validation='PRODUCTION_VALIDATED'
          then 'Os gates retrospectivos e prospectivos foram cumpridos. A certificação estatística agora está validada.'
          when v_readiness='HOLDOUT_FAILED'
          then 'O candidato não passou o teste prospectivo atual. O experimental continua disponível para diversão e acompanhamento.'
          else 'O laboratório já acompanhou '||v_sample::text||' das 200 partidas prospectivas exigidas. Isso não bloqueia o modo diversão.'
        end,
        'stage9-job:'||new.id::text||':done',
        new.id,new.target_calibration_version,
        pg_catalog.jsonb_build_object('readinessStatus',v_readiness,'sampleSize',v_sample,'requiredSampleSize',200,'validationStatus',v_validation)
      );
    end if;
  end if;

  if tg_op='UPDATE' and new.status='ERROR' and old.status is distinct from 'ERROR' then
    perform private.emit_stage9_model_lab_event(
      'LAB_ERROR','ERROR','Stage 9 encontrou um erro técnico',
      'O laboratório não conseguiu concluir esta rodada. O erro não desativa o modo diversão; a próxima correção pode retomar os testes.',
      'stage9-job:'||new.id::text||':error',new.id,new.target_calibration_version,
      pg_catalog.jsonb_build_object('protocolVersion',new.protocol_version,'error',pg_catalog.left(pg_catalog.coalesce(new.last_error,'Erro não informado.'),500))
    );
  end if;

  return new;
end;
$$;

revoke all on function private.notify_stage9_validation_job() from public,anon,authenticated;

drop trigger if exists trg_stage9_model_lab_notifications on private.model_validation_jobs;
create trigger trg_stage9_model_lab_notifications
  after insert or update on private.model_validation_jobs
  for each row execute function private.notify_stage9_validation_job();

-- Daily orchestrator. It runs the expensive calibration once when no Stage 9
-- artifact exists. Once SHADOW_READY, it only refreshes the untouched holdout.
-- A rejected fixed experiment is not re-run every day because that would waste
-- compute without adding evidence; instead we record one daily status event.
create or replace function public.kick_stage9_daily_lab()
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid;
  v_artifact_status text;
  v_validation_status text;
  v_protocol text;
  v_job_id uuid;
  v_request_id bigint;
  v_today date:=(pg_catalog.now() at time zone 'America/Sao_Paulo')::date;
begin
  v_owner:=private.stage9_model_lab_owner();
  if v_owner is null then return 'NO_OWNER'; end if;

  select a.status into v_artifact_status
  from private.model_calibration_artifacts a
  where a.market_family='1X2'
    and a.model_version='goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040'
    and a.calibration_version='stage9-ensemble-calibration-v1-fit-through-2026-05-31'
  order by a.updated_at desc
  limit 1;

  select mv.validation_status into v_validation_status
  from public.model_versions mv
  where mv.market_family='1X2'
    and mv.model_version='goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040'
    and mv.calibration_version='stage9-ensemble-calibration-v1-fit-through-2026-05-31'
  order by mv.created_at desc
  limit 1;

  if v_validation_status='PRODUCTION_VALIDATED' then
    return 'PRODUCTION_VALIDATED';
  end if;

  if v_artifact_status is null then
    v_protocol:='stage9-1x2-ensemble-calibration-v1';
  elsif v_artifact_status='SHADOW_READY' then
    v_protocol:='stage9-1x2-ensemble-prospective-holdout-v1';
  elsif v_artifact_status='HOLDOUT_PASSED' then
    perform public.promote_stage9_1x2_if_holdout_passed();
    return 'PROMOTION_RECHECKED';
  else
    perform private.emit_stage9_model_lab_event(
      'DAILY_STATUS','INFO','Stage 9 segue em laboratório',
      case when v_artifact_status='REJECTED'
        then 'A calibração atual foi rejeitada. Não vou repetir o mesmo teste sem informação nova; o modo diversão continua ativo enquanto uma nova hipótese é preparada.'
        else 'O último candidato não pode avançar. O modo diversão continua ativo e independente da certificação estatística.'
      end,
      'stage9-daily:'||v_today::text||':'||pg_catalog.coalesce(v_artifact_status,'UNKNOWN'),
      null,'stage9-ensemble-calibration-v1-fit-through-2026-05-31',
      pg_catalog.jsonb_build_object('artifactStatus',v_artifact_status,'validationStatus',v_validation_status)
    );
    return 'LAB_WAITING_'||pg_catalog.coalesce(v_artifact_status,'UNKNOWN');
  end if;

  if exists(
    select 1
    from private.model_validation_jobs j
    where j.protocol_version=v_protocol
      and (j.created_at at time zone 'America/Sao_Paulo')::date=v_today
  ) then
    return 'ALREADY_RAN_TODAY';
  end if;

  if v_protocol='stage9-1x2-ensemble-calibration-v1' then
    select k.job_id,k.request_id into v_job_id,v_request_id
    from public.kick_stage9_1x2_calibration() k;
  else
    select k.job_id,k.request_id into v_job_id,v_request_id
    from public.kick_stage9_1x2_holdout() k;
  end if;

  return case when v_request_id is null
    then 'JOB_ALREADY_ACTIVE:'||pg_catalog.coalesce(v_job_id::text,'unknown')
    else 'DISPATCHED:'||pg_catalog.coalesce(v_job_id::text,'unknown') end;
end;
$$;

revoke all on function public.kick_stage9_daily_lab() from public,anon,authenticated;
grant execute on function public.kick_stage9_daily_lab() to service_role;

-- Evaluate the Sao Paulo wall clock explicitly. The second slot is only a
-- delivery recovery attempt; kick_stage9_daily_lab is date-idempotent.
do $$ begin
  if exists(select 1 from cron.job where jobname='stage9-daily-lab') then
    perform cron.unschedule('stage9-daily-lab');
  end if;
end $$;
select cron.schedule(
  'stage9-daily-lab',
  '*/5 * * * *',
  $cron$
    select public.kick_stage9_daily_lab()
    where pg_catalog.to_char(pg_catalog.now() at time zone 'America/Sao_Paulo','HH24:MI')
      in ('06:15','06:20');
  $cron$
);

-- Seed one friendly event so the new notification box has an explicit initial
-- state immediately after deployment.
select private.emit_stage9_model_lab_event(
  'LAB_ENABLED','INFO','Stage 9 agora trabalha em paralelo',
  'O uncertainty-linear 40% continua disponível no modo diversão. A Stage 9 valida melhorias em segundo plano e avisa aqui quando houver uma mudança relevante.',
  'stage9-dual-track-enabled-2026-09-14',null,'stage9-ensemble-calibration-v1-fit-through-2026-05-31',
  pg_catalog.jsonb_build_object('experimentalMode','ACTIVE','productionValidated',false,'dailyLocalTime','06:15')
);

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260914-stage9-dual-track-lab-notifications',
  'stage9_dual_track_lab_notifications',
  'Separates entertainment-mode experimental analysis from Stage 9 statistical certification; adds owner-scoped lab notifications and a daily 06:15 America/Sao_Paulo Stage 9 orchestrator without relaxing production or real-stake gates.'
)
on conflict(version) do update
set migration_name=excluded.migration_name,notes=excluded.notes,applied_at=pg_catalog.now();
