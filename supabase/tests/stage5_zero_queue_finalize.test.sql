begin;
select plan(2);

select lives_ok(
$outer$
do $test$
declare
  v_user uuid := '52525252-5252-4525-8525-525252525252'::uuid;
  v_run uuid;
begin
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_user,'authenticated','authenticated','stage5-zero-queue@example.invalid','{"provider":"google","providers":["google"]}'::jsonb,'{}'::jsonb,now(),now());

  select run_id into v_run from public.create_analysis_run_atomic(
    v_user,'52525252-5252-4525-8525-525252525253'::uuid,'2026-10-13'::date,'zero-auto.csv',0,array['Liga'],array['Data','Partida','Horário','Campeonato'],
    '[{"partida":"K x L","horario":"13:00","campeonato":"Liga"}]'::jsonb
  );

  perform public.replace_decision_queue_atomic(v_run,v_user,'[]'::jsonb);
  insert into public.pipeline_logs(run_id,step,level,message,payload)
  values(v_run,'DECISION_QUEUE_EVALUATED','INFO','Fila de decisão avaliada sem opções qualificadas.','{"totalQualified":0}'::jsonb);

  perform public.next_decision_batch_atomic(v_run,v_user,10);

  if not exists(
    select 1 from public.analysis_runs where id=v_run and selection_finalized_at is not null
  ) then
    raise exception 'evaluated empty queue remained pending';
  end if;
  if exists(
    select 1 from public.experimental_bet_tracking where run_id=v_run and bet_status in ('PROPOSED','OPEN')
  ) then
    raise exception 'empty queue created a stake row';
  end if;
end
$test$
$outer$,
'evaluated empty decision queue auto-finalizes as zero bets without stake'
);

select ok(
  exists(select 1 from public.app_schema_releases where version='20260913-stage5-zero-queue-finalize'),
  'Stage 5 zero-queue finalize release is registered'
);

select * from finish();
rollback;
