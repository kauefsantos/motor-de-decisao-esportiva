begin;
select plan(22);

select ok(to_regclass('public.analysis_drafts') is not null,'analysis draft table exists');
select ok(to_regclass('public.analysis_draft_games') is not null,'analysis draft games table exists');
select ok(to_regclass('public.decision_opportunity_queue') is not null,'decision opportunity queue exists');
select ok(to_regclass('public.external_api_cache') is not null,'distributed external API cache exists');
select ok(to_regclass('public.external_api_rate_state') is not null,'distributed external API rate state exists');

select ok(
  exists(select 1 from pg_indexes where schemaname='public' and indexname='uq_analysis_runs_owner_idempotency'),
  'analysis creation has an owner-scoped idempotency index'
);
select ok(
  has_function_privilege('service_role','public.create_analysis_run_atomic(uuid,uuid,date,text,integer,text[],text[],jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.create_analysis_run_atomic(uuid,uuid,date,text,integer,text[],text[],jsonb)','EXECUTE'),
  'atomic run creation is service-only'
);
select ok(
  has_function_privilege('service_role','public.enqueue_analysis_job_atomic(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.enqueue_analysis_job_atomic(uuid,uuid)','EXECUTE'),
  'atomic enqueue is service-only'
);
select ok(
  has_function_privilege('service_role','public.retry_analysis_job_atomic(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.retry_analysis_job_atomic(uuid,uuid)','EXECUTE'),
  'compare-and-set retry is service-only'
);
select ok(
  has_function_privilege('service_role','public.replace_run_value_analysis_atomic(uuid,uuid,jsonb,jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.replace_run_value_analysis_atomic(uuid,uuid,jsonb,jsonb,jsonb)','EXECUTE'),
  'atomic odds replacement is service-only'
);

select lives_ok(
$outer$
do $test$
declare
  v_user uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid;
  v_key uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid;
  v_run1 uuid;
  v_run2 uuid;
  v_reused1 boolean;
  v_reused2 boolean;
  v_created1 boolean;
  v_created2 boolean;
  v_retried1 boolean;
  v_retried2 boolean;
begin
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_user,'authenticated','authenticated','backend-funnel@example.invalid','{"provider":"google","providers":["google"]}'::jsonb,'{}'::jsonb,now(),now());

  select run_id,reused into v_run1,v_reused1 from public.create_analysis_run_atomic(
    v_user,v_key,'2026-09-20'::date,'test.csv',0,array['Liga Teste'],array['Data','Partida','Horário','Campeonato'],
    '[{"partida":"Time A x Time B","horario":"16:00","campeonato":"Liga Teste"}]'::jsonb
  );
  select run_id,reused into v_run2,v_reused2 from public.create_analysis_run_atomic(
    v_user,v_key,'2026-09-20'::date,'test.csv',0,array['Liga Teste'],array['Data','Partida','Horário','Campeonato'],
    '[{"partida":"Time A x Time B","horario":"16:00","campeonato":"Liga Teste"}]'::jsonb
  );
  if v_run1 is distinct from v_run2 or v_reused1 or not v_reused2 then raise exception 'idempotency result mismatch'; end if;
  if (select count(*) from public.analysis_runs where owner_id=v_user and idempotency_key=v_key)<>1 then raise exception 'duplicate run'; end if;
  if (select count(*) from public.uploaded_files where run_id=v_run1)<>1 then raise exception 'upload metadata missing'; end if;
  if (select count(*) from public.matches where run_id=v_run1)<>1 then raise exception 'match creation mismatch'; end if;

  select created into v_created1 from public.enqueue_analysis_job_atomic(v_run1,v_user);
  select created into v_created2 from public.enqueue_analysis_job_atomic(v_run1,v_user);
  if not v_created1 or v_created2 then raise exception 'enqueue was not idempotent'; end if;
  if (select count(*) from public.analysis_jobs where run_id=v_run1)<>1 then raise exception 'duplicate analysis job'; end if;

  update public.analysis_jobs set status='ERROR' where run_id=v_run1;
  select retried into v_retried1 from public.retry_analysis_job_atomic(v_run1,v_user);
  select retried into v_retried2 from public.retry_analysis_job_atomic(v_run1,v_user);
  if not v_retried1 or v_retried2 then raise exception 'retry compare-and-set failed'; end if;
end
$test$
$outer$,
'atomic creation/enqueue/retry are idempotent under repeated requests'
);

select lives_ok(
$outer$
do $test$
declare
  v_user uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid;
  v_run uuid;
  v_q uuid;
  v_n integer;
  v_failed boolean := false;
begin
  select id into v_run from public.analysis_runs where owner_id=v_user and idempotency_key='cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid;
  perform public.replace_decision_queue_atomic(v_run,v_user,
  '[
    {"prediction_id":"Q1","rank_global":1,"match_label":"A x B","competition":"Liga","market_family":"1X2","market":"1x2","market_label":"A vence","side":"HOME","model_version":"test-v1","model_status":"EXPERIMENTAL_CURRENT_SEASON","model_probability":0.76,"fair_odd":1.31,"entry_odd":2.10,"min_odd_target":1.35,"edge":0.20,"expected_value":0.25},
    {"prediction_id":"Q2","rank_global":2,"match_label":"C x D","competition":"Liga","market_family":"1X2","market":"1x2","market_label":"C vence","side":"HOME","model_version":"test-v1","model_status":"EXPERIMENTAL_CURRENT_SEASON","model_probability":0.77,"fair_odd":1.30,"entry_odd":2.00,"min_odd_target":1.33,"edge":0.18,"expected_value":0.20},
    {"prediction_id":"Q3","rank_global":3,"match_label":"E x F","competition":"Liga","market_family":"1X2","market":"1x2","market_label":"E vence","side":"HOME","model_version":"test-v1","model_status":"EXPERIMENTAL_CURRENT_SEASON","model_probability":0.78,"fair_odd":1.28,"entry_odd":1.95,"min_odd_target":1.31,"edge":0.16,"expected_value":0.18},
    {"prediction_id":"Q4","rank_global":4,"match_label":"G x H","competition":"Liga","market_family":"1X2","market":"1x2","market_label":"G vence","side":"HOME","model_version":"test-v1","model_status":"EXPERIMENTAL_CURRENT_SEASON","model_probability":0.79,"fair_odd":1.27,"entry_odd":1.90,"min_odd_target":1.29,"edge":0.14,"expected_value":0.15}
  ]'::jsonb);
  select count(*) into v_n from public.next_decision_batch_atomic(v_run,v_user,10);
  if v_n<>4 then raise exception 'expected four shown opportunities, got %',v_n; end if;

  for v_q in select id from public.decision_opportunity_queue where run_id=v_run order by rank_global limit 3 loop
    perform public.accept_decision_opportunity_atomic(v_q,v_user);
  end loop;
  if (select count(*) from public.decision_opportunity_queue where run_id=v_run and queue_state='ACCEPTED')<>3 then raise exception 'three choices were not accepted'; end if;
  if (select count(*) from public.experimental_bet_tracking where run_id=v_run and bet_status='PROPOSED')<>3 then raise exception 'accepted choices were not transferred to stake ledger'; end if;

  select id into v_q from public.decision_opportunity_queue where run_id=v_run and prediction_id='Q4';
  begin
    perform public.accept_decision_opportunity_atomic(v_q,v_user);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'fourth daily choice was incorrectly accepted'; end if;

  update public.experimental_bet_tracking set bet_status='DECLINED'
    where run_id=v_run and prediction_id='Q1';
  if not exists(select 1 from public.decision_opportunity_queue where run_id=v_run and prediction_id='Q1' and queue_state='DECLINED') then
    raise exception 'stake decline did not release queue choice';
  end if;
end
$test$
$outer$,
'decision queue shows available choices, caps daily acceptance at three and releases a declined stake'
);

select lives_ok(
$outer$
do $test$
declare a1 boolean; a2 boolean; a3 boolean; a4 boolean;
begin
  delete from public.external_api_rate_state where provider='five_dollar_test';
  select allowed into a1 from public.acquire_external_api_slot('five_dollar_test',3,60);
  select allowed into a2 from public.acquire_external_api_slot('five_dollar_test',3,60);
  select allowed into a3 from public.acquire_external_api_slot('five_dollar_test',3,60);
  select allowed into a4 from public.acquire_external_api_slot('five_dollar_test',3,60);
  if not a1 or not a2 or not a3 or a4 then raise exception 'distributed rate window did not enforce requested cap'; end if;
end
$test$
$outer$,
'distributed rate limiter serializes one shared provider window'
);

select ok(
  not has_table_privilege('authenticated','public.analysis_drafts','SELECT')
  and not has_table_privilege('authenticated','public.analysis_draft_games','SELECT'),
  'draft validation data is not directly browser-readable'
);
select ok(
  not has_table_privilege('authenticated','public.decision_opportunity_queue','SELECT'),
  'decision queue is not directly browser-readable'
);
select ok(
  not has_table_privilege('authenticated','public.external_api_cache','SELECT')
  and not has_table_privilege('authenticated','public.external_api_rate_state','SELECT'),
  'external API cache/rate state are not browser-readable'
);
select ok(
  exists(select 1 from pg_trigger where tgname='trg_experimental_selection_limit' and not tgisinternal),
  'daily selection limit trigger remains active'
);
select ok(
  exists(select 1 from pg_trigger where tgname='trg_sync_decision_queue_from_tracking' and not tgisinternal),
  'stake-decline to decision-queue synchronization trigger exists'
);
select is(
  (select count(*)::integer from public.external_api_capabilities where provider='five_dollar'),
  6,
  'six explicit FiveDollar capability gates are registered'
);
select ok(
  exists(select 1 from public.external_api_capabilities where provider='five_dollar' and capability_key='odds_tick_history' and not enabled and minimum_plan='ultra'),
  'Ultra tick-history capability is explicitly disabled on current backend'
);
select ok(
  exists(select 1 from public.external_api_capabilities where provider='five_dollar' and capability_key='events_stats' and enabled and metadata->>'model_feature_gate'='research_only'),
  'rich events/stats are enabled for research but gated from model pricing'
);
select ok(
  exists(select 1 from cron.job where jobname='five-dollar-maintenance-daily' and active),
  'daily FiveDollar maintenance/prewarm job is scheduled'
);
select ok(
  has_function_privilege('service_role','public.validate_external_api_maintenance_token(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.validate_external_api_maintenance_token(uuid)','EXECUTE'),
  'maintenance capability validation is service-only'
);
select ok(
  has_function_privilege('service_role','public.next_decision_batch_atomic(uuid,uuid,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.next_decision_batch_atomic(uuid,uuid,integer)','EXECUTE'),
  'decision batch transition is service-only'
);
select ok(
  has_function_privilege('service_role','public.apply_analysis_draft_corrections(uuid,uuid,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.apply_analysis_draft_corrections(uuid,uuid,jsonb)','EXECUTE'),
  'draft corrections are service-only'
);
select ok(
  exists(select 1 from public.app_schema_releases where version='20260912-backend-api-funnel'),
  'backend/API funnel release is registered'
);

select * from finish();
rollback;
