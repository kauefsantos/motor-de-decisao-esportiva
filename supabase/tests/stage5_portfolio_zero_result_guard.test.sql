begin;
select plan(4);

select lives_ok(
$outer$
do $test$
declare
  v_user uuid := '51515151-5151-4515-8515-515151515151'::uuid;
  v_run1 uuid;
  v_run2 uuid;
  v_m1 uuid;
  v_m2 uuid;
  v_m3 uuid;
  v_q uuid;
  v_blocked boolean := false;
begin
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_user,'authenticated','authenticated','stage5-portfolio@example.invalid','{"provider":"google","providers":["google"]}'::jsonb,'{}'::jsonb,now(),now());

  select run_id into v_run1 from public.create_analysis_run_atomic(
    v_user,'51515151-5151-4515-8515-515151515152'::uuid,'2026-10-10'::date,'family-1.csv',0,array['Liga'],array['Data','Partida','Horário','Campeonato'],
    '[{"partida":"A x B","horario":"13:00","campeonato":"Liga"},{"partida":"C x D","horario":"15:00","campeonato":"Liga"}]'::jsonb
  );
  select run_id into v_run2 from public.create_analysis_run_atomic(
    v_user,'51515151-5151-4515-8515-515151515153'::uuid,'2026-10-10'::date,'family-2.csv',0,array['Liga'],array['Data','Partida','Horário','Campeonato'],
    '[{"partida":"E x F","horario":"17:00","campeonato":"Liga"}]'::jsonb
  );

  select id into v_m1 from public.matches where run_id=v_run1 and raw_partida='A x B';
  select id into v_m2 from public.matches where run_id=v_run1 and raw_partida='C x D';
  select id into v_m3 from public.matches where run_id=v_run2 and raw_partida='E x F';

  insert into public.model_versions(market_family,model_version,calibration_version,validation_status,out_of_sample_metrics)
  values('1X2','stage5-family-v1','stage5-family-cal-v1','PRODUCTION_VALIDATED','{"test":true}'::jsonb);

  insert into public.model_predictions(
    run_id,match_id,prediction_id,market,side,model_probability,p_cal,conservative_probability,
    model_version,calibration_version,model_status,data_status
  ) values
    (v_run1,v_m1,'STAGE5-F1','1x2','HOME',0.80,0.79,0.78,'stage5-family-v1','stage5-family-cal-v1','PRODUCTION_VALIDATED','OK'),
    (v_run1,v_m2,'STAGE5-F2','1x2','HOME',0.80,0.79,0.78,'stage5-family-v1','stage5-family-cal-v1','PRODUCTION_VALIDATED','OK'),
    (v_run2,v_m3,'STAGE5-F3','1x2','HOME',0.80,0.79,0.78,'stage5-family-v1','stage5-family-cal-v1','PRODUCTION_VALIDATED','OK');

  perform public.replace_decision_queue_atomic(v_run1,v_user,jsonb_build_array(
    jsonb_build_object('match_id',v_m1,'prediction_id','STAGE5-F1','rank_global',1,'match_label','A x B','competition','Liga','market_family','1X2','market','1x2','market_label','A vence','side','HOME','model_version','stage5-family-v1','model_status','PRODUCTION_VALIDATED','model_probability',0.78,'fair_odd',1.28,'entry_odd',2.00,'min_odd_target',1.70,'edge',0.28,'expected_value',0.56),
    jsonb_build_object('match_id',v_m2,'prediction_id','STAGE5-F2','rank_global',2,'match_label','C x D','competition','Liga','market_family','1X2','market','1x2','market_label','C vence','side','HOME','model_version','stage5-family-v1','model_status','PRODUCTION_VALIDATED','model_probability',0.78,'fair_odd',1.28,'entry_odd',2.00,'min_odd_target',1.70,'edge',0.28,'expected_value',0.56)
  ));
  perform public.replace_decision_queue_atomic(v_run2,v_user,jsonb_build_array(
    jsonb_build_object('match_id',v_m3,'prediction_id','STAGE5-F3','rank_global',1,'match_label','E x F','competition','Liga','market_family','1X2','market','1x2','market_label','E vence','side','HOME','model_version','stage5-family-v1','model_status','PRODUCTION_VALIDATED','model_probability',0.78,'fair_odd',1.28,'entry_odd',2.00,'min_odd_target',1.70,'edge',0.28,'expected_value',0.56)
  ));

  perform public.next_decision_batch_atomic(v_run1,v_user,10);
  for v_q in select id from public.decision_opportunity_queue where run_id=v_run1 order by rank_global loop
    perform public.accept_decision_opportunity_atomic(v_q,v_user);
  end loop;

  perform public.next_decision_batch_atomic(v_run2,v_user,10);
  select id into v_q from public.decision_opportunity_queue where run_id=v_run2 and queue_state='SHOWN' limit 1;
  begin
    perform public.accept_decision_opportunity_atomic(v_q,v_user);
  exception when others then
    v_blocked := position('2 escolhas da mesma família' in sqlerrm)>0;
  end;
  if not v_blocked then raise exception 'third daily selection from same family was accepted'; end if;
end
$test$
$outer$,
'daily portfolio rejects a third accepted selection from the same family across runs'
);

select lives_ok(
$outer$
do $test$
declare
  v_user uuid := '51515151-5151-4515-8515-515151515151'::uuid;
  v_run uuid;
  v_finalized boolean;
  v_count integer;
begin
  select run_id into v_run from public.create_analysis_run_atomic(
    v_user,'51515151-5151-4515-8515-515151515154'::uuid,'2026-10-11'::date,'zero-empty.csv',0,array['Liga'],array['Data','Partida','Horário','Campeonato'],
    '[{"partida":"G x H","horario":"13:00","campeonato":"Liga"}]'::jsonb
  );
  perform public.replace_decision_queue_atomic(v_run,v_user,'[]'::jsonb);
  select finalized,accepted_count into v_finalized,v_count from public.finalize_decision_selection_atomic(v_run,v_user);
  if not v_finalized or v_count<>0 then raise exception 'empty portfolio did not finalize as zero'; end if;
  if not exists(select 1 from public.analysis_runs where id=v_run and selection_finalized_at is not null) then
    raise exception 'zero-result finalization timestamp missing';
  end if;
end
$test$
$outer$,
'empty qualified portfolio can be finalized as a valid zero-bet result'
);

select lives_ok(
$outer$
do $test$
declare
  v_user uuid := '51515151-5151-4515-8515-515151515151'::uuid;
  v_run uuid;
  v_match uuid;
  v_q uuid;
begin
  select run_id into v_run from public.create_analysis_run_atomic(
    v_user,'51515151-5151-4515-8515-515151515155'::uuid,'2026-10-12'::date,'zero-decline.csv',0,array['Liga'],array['Data','Partida','Horário','Campeonato'],
    '[{"partida":"I x J","horario":"13:00","campeonato":"Liga"}]'::jsonb
  );
  select id into v_match from public.matches where run_id=v_run limit 1;

  insert into public.model_predictions(
    run_id,match_id,prediction_id,market,side,model_probability,p_cal,conservative_probability,
    model_version,calibration_version,model_status,data_status
  ) values(
    v_run,v_match,'STAGE5-ZERO-1','1x2','HOME',0.80,0.79,0.78,
    'stage5-family-v1','stage5-family-cal-v1','PRODUCTION_VALIDATED','OK'
  );
  perform public.replace_decision_queue_atomic(v_run,v_user,jsonb_build_array(
    jsonb_build_object('match_id',v_match,'prediction_id','STAGE5-ZERO-1','rank_global',1,'match_label','I x J','competition','Liga','market_family','1X2','market','1x2','market_label','I vence','side','HOME','model_version','stage5-family-v1','model_status','PRODUCTION_VALIDATED','model_probability',0.78,'fair_odd',1.28,'entry_odd',2.00,'min_odd_target',1.70,'edge',0.28,'expected_value',0.56)
  ));
  perform public.next_decision_batch_atomic(v_run,v_user,10);
  select id into v_q from public.decision_opportunity_queue where run_id=v_run and queue_state='SHOWN' limit 1;
  perform public.decline_decision_opportunity_atomic(v_q,v_user);

  if not exists(select 1 from public.analysis_runs where id=v_run and selection_finalized_at is not null) then
    raise exception 'declining the last option did not finalize zero selections';
  end if;
  if exists(select 1 from public.experimental_bet_tracking where run_id=v_run and bet_status in ('PROPOSED','OPEN')) then
    raise exception 'zero-selection result created a stake row';
  end if;
end
$test$
$outer$,
'declining the final option persists a terminal zero-bet result without stake'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260913-stage5-portfolio-zero-result-guard'),
  'Stage 5 portfolio zero-result guard release is registered'
);

select * from finish();
rollback;
