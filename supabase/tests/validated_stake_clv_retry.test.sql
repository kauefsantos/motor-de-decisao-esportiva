begin;
select plan(6);

select ok(
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='experimental_bet_tracking' and column_name='clv_attempts')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='experimental_bet_tracking' and column_name='clv_next_retry_at'),
  'CLV retry state is persisted'
);

select ok(
  exists(select 1 from pg_trigger where tgname='trg_experimental_validated_stake' and not tgisinternal),
  'validated stake trigger is installed'
);

select ok(
  has_function_privilege('service_role','public.get_due_clv_tracking_ids(uuid,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_due_clv_tracking_ids(uuid,integer)','EXECUTE'),
  'due CLV retry lookup is service-only'
);

select lives_ok(
$outer$
do $test$
declare
  v_user uuid := 'abababab-abab-4bab-8bab-abababababab'::uuid;
  v_run uuid;
  v_match uuid;
  v_tracking uuid;
  v_blocked boolean := false;
begin
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_user,'authenticated','authenticated','stake-gate@example.invalid','{"provider":"google","providers":["google"]}'::jsonb,'{}'::jsonb,now(),now());

  select run_id into v_run from public.create_analysis_run_atomic(
    v_user,'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'::uuid,'2026-10-01'::date,'stake.csv',0,array['Liga'],array['Data','Partida','Horário','Campeonato'],
    '[{"partida":"A x B","horario":"16:00","campeonato":"Liga"}]'::jsonb
  );
  select id into v_match from public.matches where run_id=v_run limit 1;

  insert into public.model_predictions(run_id,match_id,prediction_id,market,side,model_probability,model_version,model_status,data_status)
  values(v_run,v_match,'STAKE-EXP-1','goals_match_total','OVER',0.95,'stake-exp-v1','EXPERIMENTAL_CURRENT_SEASON','OK');

  insert into public.experimental_bet_tracking(
    run_id,match_id,prediction_id,target_date,match_label,competition,market_family,market,market_label,side,
    model_version,model_status,model_probability,entry_odd,expected_value,edge,bet_status,result
  ) values(
    v_run,v_match,'STAKE-EXP-1','2026-10-01','A x B','Liga','GOALS','goals_match_total','Mais de 2.5','OVER',
    'stake-exp-v1','EXPERIMENTAL_CURRENT_SEASON',0.95,2.0,0.90,0.45,'PROPOSED','PENDING'
  ) returning id into v_tracking;

  begin
    update public.experimental_bet_tracking set stake_brl=1,bet_status='OPEN' where id=v_tracking;
  exception when others then
    v_blocked := position('Stake operacional exige previsão validada' in sqlerrm)>0;
  end;
  if not v_blocked then raise exception 'experimental row accepted positive stake'; end if;
end
$test$
$outer$,
'experimental signal cannot receive positive operational stake'
);

select lives_ok(
$outer$
do $test$
declare
  v_user uuid := 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc'::uuid;
  v_run uuid;
  v_match uuid;
  v_tracking uuid;
begin
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_user,'authenticated','authenticated','legacy-settle@example.invalid','{"provider":"google","providers":["google"]}'::jsonb,'{}'::jsonb,now(),now());

  select run_id into v_run from public.create_analysis_run_atomic(
    v_user,'dededede-dede-4ede-8ede-dededededede'::uuid,'2026-10-02'::date,'legacy.csv',0,array['Liga'],array['Data','Partida','Horário','Campeonato'],
    '[{"partida":"C x D","horario":"16:00","campeonato":"Liga"}]'::jsonb
  );
  select id into v_match from public.matches where run_id=v_run limit 1;

  insert into public.model_predictions(run_id,match_id,prediction_id,market,side,model_probability,model_version,model_status,data_status)
  values(v_run,v_match,'LEGACY-OPEN-1','goals_match_total','OVER',0.80,'legacy-v1','EXPERIMENTAL_CURRENT_SEASON','OK');

  insert into public.experimental_bet_tracking(
    run_id,match_id,prediction_id,target_date,match_label,competition,market_family,market,market_label,side,
    model_version,model_status,model_probability,entry_odd,expected_value,edge,bet_status,result,stake_brl
  ) values(
    v_run,v_match,'LEGACY-OPEN-1','2026-10-02','C x D','Liga','GOALS','goals_match_total','Mais de 2.5','OVER',
    'legacy-v1','EXPERIMENTAL_CURRENT_SEASON',0.80,2.0,0.30,0.20,'PROPOSED','PENDING',null
  ) returning id into v_tracking;

  -- Simulate a genuinely historical OPEN row without authorizing a new stake
  -- through the new trigger: disable only inside this rollbacked test transaction.
  alter table public.experimental_bet_tracking disable trigger trg_experimental_validated_stake;
  update public.experimental_bet_tracking set bet_status='OPEN',stake_brl=1 where id=v_tracking;
  alter table public.experimental_bet_tracking enable trigger trg_experimental_validated_stake;

  update public.experimental_bet_tracking
  set bet_status='SETTLED',result='WIN',profit_brl=1,profit_units=1
  where id=v_tracking;
end
$test$
$outer$,
'legacy OPEN bet can still be settled without changing its historical stake'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260912-validated-stake-clv-retry'),
  'validated stake and CLV retry release is registered'
);

select * from finish();
rollback;
