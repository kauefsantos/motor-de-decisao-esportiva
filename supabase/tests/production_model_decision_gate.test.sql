begin;
select plan(3);

select ok(
  position('PRODUCTION_VALIDATED' in pg_get_functiondef('public.replace_decision_queue_atomic(uuid,uuid,jsonb)'::regprocedure)) > 0,
  'decision queue RPC requires production validated models'
);

select lives_ok(
$outer$
do $test$
declare
  v_user uuid := '11111111-aaaa-4aaa-8aaa-111111111111'::uuid;
  v_key uuid := '22222222-bbbb-4bbb-8bbb-222222222222'::uuid;
  v_run uuid;
  v_match uuid;
  v_count integer;
begin
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_user,'authenticated','authenticated','quant-gate@example.invalid','{"provider":"google","providers":["google"]}'::jsonb,'{}'::jsonb,now(),now());

  select run_id into v_run
  from public.create_analysis_run_atomic(
    v_user,v_key,'2026-09-21'::date,'quant-gate.csv',0,array['Liga Teste'],
    array['Data','Partida','Horário','Campeonato'],
    '[{"partida":"Time C x Time D","horario":"16:00","campeonato":"Liga Teste"}]'::jsonb
  );

  select id into v_match from public.matches where run_id=v_run limit 1;

  insert into public.model_predictions(
    run_id,match_id,prediction_id,market,participant,side,line_raw,line_canonical,
    model_probability,model_version,model_status,data_status
  ) values (
    v_run,v_match,'EXPERIMENTAL-GATE-1','corners_team_total','Time C','OVER','4.5',4.5,
    0.95,'experimental-gate-v1','EXPERIMENTAL_CURRENT_SEASON','OK'
  );

  select public.replace_decision_queue_atomic(
    v_run,v_user,
    jsonb_build_array(jsonb_build_object(
      'match_id',v_match,'prediction_id','EXPERIMENTAL-GATE-1','rank_global',1,
      'match_label','Time C x Time D','competition','Liga Teste','market_family','CORNERS',
      'market','corners_team_total','market_label','Escanteios Time C Mais de 4.5','participant','Time C','side','OVER',
      'line_canonical',4.5,'model_version','experimental-gate-v1','model_status','EXPERIMENTAL_CURRENT_SEASON',
      'model_probability',0.95,'fair_odd',1.052631,'entry_odd',2.00,'min_odd_target',1.70,'edge',0.45,'expected_value',0.90
    ))
  ) into v_count;

  if v_count <> 0 then raise exception 'experimental prediction produced executable queue rows'; end if;
  if exists(select 1 from public.decision_opportunity_queue where run_id=v_run) then
    raise exception 'experimental prediction persisted in executable queue';
  end if;
end
$test$
$outer$,
'experimental prediction resolves safely to zero executable bets even with extreme raw p/EV/edge'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260912-production-model-decision-gate'),
  'production model decision gate release is registered'
);

select * from finish();
rollback;
