begin;
select plan(2);

select ok(
  exists(
    select 1
    from pg_trigger
    where tgname='trg_decision_queue_line_compatibility'
      and not tgisinternal
  ),
  'decision queue line compatibility trigger exists'
);

select lives_ok(
$outer$
do $test$
declare
  v_user uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid;
  v_key uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid;
  v_run uuid;
  v_match uuid;
  v_blocked boolean := false;
begin
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_user,'authenticated','authenticated','line-defense@example.invalid','{"provider":"google","providers":["google"]}'::jsonb,'{}'::jsonb,now(),now());

  select run_id into v_run
  from public.create_analysis_run_atomic(
    v_user,
    v_key,
    '2026-09-20'::date,
    'line-defense.csv',
    0,
    array['Liga Teste'],
    array['Data','Partida','Horário','Campeonato'],
    '[{"partida":"Time A x Time B","horario":"16:00","campeonato":"Liga Teste"}]'::jsonb
  );

  select id into v_match
  from public.matches
  where run_id=v_run
  limit 1;

  insert into public.model_versions(
    market_family,model_version,calibration_version,validation_status,out_of_sample_metrics
  ) values (
    'CORNERS','test-line-v1','cal-line-v1','PRODUCTION_VALIDATED','{"test":true}'::jsonb
  );

  insert into public.model_predictions(
    run_id,match_id,prediction_id,market,participant,side,line_raw,line_canonical,
    model_probability,p_cal,conservative_probability,model_version,calibration_version,model_status,data_status
  ) values (
    v_run,v_match,'LINE-GUARD-1','corners_team_total','Time A','OVER','4.5',4.5,
    0.78,0.76,0.75,'test-line-v1','cal-line-v1','PRODUCTION_VALIDATED','OK'
  );

  begin
    perform public.replace_decision_queue_atomic(
      v_run,
      v_user,
      jsonb_build_array(jsonb_build_object(
        'match_id',v_match,
        'prediction_id','LINE-GUARD-1',
        'rank_global',1,
        'match_label','Time A x Time B',
        'competition','Liga Teste',
        'market_family','CORNERS',
        'market','corners_team_total',
        'market_label','Escanteios Time A Mais de 9.5',
        'participant','Time A',
        'side','OVER',
        'line_canonical',9.5,
        'model_version','test-line-v1',
        'model_status','PRODUCTION_VALIDATED',
        'model_probability',0.75,
        'fair_odd',1.333333,
        'entry_odd',2.00,
        'min_odd_target',1.70,
        'edge',0.25,
        'expected_value',0.50
      ))
    );
  exception when others then
    if position('Linha da oportunidade incompatível' in sqlerrm) > 0 then
      v_blocked := true;
    else
      raise;
    end if;
  end;

  if not v_blocked then
    raise exception 'forged line was accepted by the final decision queue';
  end if;

  perform public.replace_decision_queue_atomic(
    v_run,
    v_user,
    jsonb_build_array(jsonb_build_object(
      'match_id',v_match,
      'prediction_id','LINE-GUARD-1',
      'rank_global',1,
      'match_label','Time A x Time B',
      'competition','Liga Teste',
      'market_family','CORNERS',
      'market','corners_team_total',
      'market_label','Escanteios Time A Mais de 4.5',
      'participant','Time A',
      'side','OVER',
      'line_canonical',4.5,
      'model_version','test-line-v1',
      'model_status','PRODUCTION_VALIDATED',
      'model_probability',0.75,
      'fair_odd',1.333333,
      'entry_odd',2.00,
      'min_odd_target',1.70,
      'edge',0.25,
      'expected_value',0.50
    ))
  );

  if (
    select count(*)
    from public.decision_opportunity_queue
    where run_id=v_run
      and prediction_id='LINE-GUARD-1'
      and line_canonical=4.5
  ) <> 1 then
    raise exception 'matching validated modelled line was not persisted';
  end if;
end
$test$
$outer$,
'Lovable Cloud rejects a forged line and accepts the validated modelled line'
);

select * from finish();
rollback;
