begin;
select plan(6);

select ok(
  exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='analysis_runs' and column_name='selection_finalized_at'
  ),
  'analysis run records explicit user selection finalization'
);

select ok(
  pg_get_constraintdef(c.oid) like '%BLOCKED_CORRELATED%'
  from pg_constraint c
  where c.conrelid='public.decision_opportunity_queue'::regclass
    and c.conname='decision_opportunity_queue_queue_state_check',
  'decision queue supports explicit correlated-blocked state'
);

select ok(
  has_function_privilege('service_role','public.finalize_decision_selection_atomic(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.finalize_decision_selection_atomic(uuid,uuid)','EXECUTE'),
  'selection finalization is service-only'
);

select is(
  (select schedule from cron.job where jobname='five-dollar-maintenance-daily' and active),
  '10,25,40,55 6 * * *',
  'FiveDollar maintenance has four bounded retry/prewarm passes'
);

select lives_ok(
$outer$
do $test$
declare
  v_user uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid;
  v_run uuid;
  v_match1 uuid;
  v_match2 uuid;
  v_q1 uuid;
  v_shown integer;
  v_finalized boolean;
  v_accepted integer;
begin
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_user,'authenticated','authenticated','integration-audit@example.invalid','{"provider":"google","providers":["google"]}'::jsonb,'{}'::jsonb,now(),now());

  select run_id into v_run from public.create_analysis_run_atomic(
    v_user,
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid,
    '2026-09-21'::date,
    'audit.csv',0,array['Liga'],array['Data','Partida','Horário','Campeonato'],
    '[{"partida":"Time A x Time B","horario":"16:00","campeonato":"Liga"},{"partida":"Time C x Time D","horario":"18:00","campeonato":"Liga"}]'::jsonb
  );

  select id into v_match1 from public.matches where run_id=v_run and raw_partida='Time A x Time B';
  select id into v_match2 from public.matches where run_id=v_run and raw_partida='Time C x Time D';

  perform public.replace_decision_queue_atomic(v_run,v_user,jsonb_build_array(
    jsonb_build_object('match_id',v_match1,'prediction_id','A1','rank_global',1,'match_label','Time A x Time B','competition','Liga','market_family','GOALS','market','goals_match_total','market_label','Mais de 2.5','side','OVER','line_canonical',2.5,'model_version','test-v1','model_status','EXPERIMENTAL_CURRENT_SEASON','model_probability',0.78,'fair_odd',1.28,'entry_odd',1.90,'min_odd_target',1.45,'edge',0.18,'expected_value',0.22),
    jsonb_build_object('match_id',v_match1,'prediction_id','A2','rank_global',2,'match_label','Time A x Time B','competition','Liga','market_family','CORNERS','market','corners_match_total','market_label','Mais de 9.5','side','OVER','line_canonical',9.5,'model_version','test-v1','model_status','EXPERIMENTAL_CURRENT_SEASON','model_probability',0.76,'fair_odd',1.31,'entry_odd',1.95,'min_odd_target',1.48,'edge',0.16,'expected_value',0.19),
    jsonb_build_object('match_id',v_match2,'prediction_id','B1','rank_global',3,'match_label','Time C x Time D','competition','Liga','market_family','CARDS','market','cards_match_total','market_label','Mais de 4.5','side','OVER','line_canonical',4.5,'model_version','test-v1','model_status','EXPERIMENTAL_CURRENT_SEASON','model_probability',0.75,'fair_odd',1.33,'entry_odd',2.00,'min_odd_target',1.50,'edge',0.15,'expected_value',0.18)
  ));

  select count(*) into v_shown from public.next_decision_batch_atomic(v_run,v_user,10);
  if v_shown<>2 then raise exception 'expected one visible market per match, got %',v_shown; end if;
  if not exists(select 1 from public.decision_opportunity_queue where run_id=v_run and prediction_id='A2' and queue_state='AVAILABLE') then
    raise exception 'same-match alternate was not deferred';
  end if;

  select id into v_q1 from public.decision_opportunity_queue where run_id=v_run and prediction_id='A1';
  perform public.accept_decision_opportunity_atomic(v_q1,v_user);
  if not exists(select 1 from public.decision_opportunity_queue where run_id=v_run and prediction_id='A2' and queue_state='BLOCKED_CORRELATED') then
    raise exception 'accept did not block correlated alternate';
  end if;

  select finalized,accepted_count into v_finalized,v_accepted
    from public.finalize_decision_selection_atomic(v_run,v_user);
  if not v_finalized or v_accepted<>1 then raise exception 'user could not deliberately finish with one choice'; end if;
  if not exists(select 1 from public.analysis_runs where id=v_run and selection_finalized_at is not null) then
    raise exception 'selection finalization timestamp missing';
  end if;

  update public.experimental_bet_tracking set bet_status='DECLINED'
    where run_id=v_run and prediction_id='A1';
  if not exists(select 1 from public.decision_opportunity_queue where run_id=v_run and prediction_id='A2' and queue_state='AVAILABLE') then
    raise exception 'stake decline did not reopen qualified correlated alternate';
  end if;
  if exists(select 1 from public.analysis_runs where id=v_run and selection_finalized_at is not null) then
    raise exception 'stake decline did not reopen the selection phase';
  end if;
end
$test$
$outer$,
'up-to-three flow defers correlations, allows voluntary finish and reopens after stake decline'
);

select ok(
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sync_decision_queue_from_tracking'),
  'stake ledger synchronization remains installed'
);

select * from finish();
rollback;
