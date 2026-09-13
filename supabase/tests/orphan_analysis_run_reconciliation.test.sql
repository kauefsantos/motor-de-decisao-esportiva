begin;
select plan(5);

select ok(
  to_regprocedure('public.reconcile_orphan_analysis_runs(integer)') is not null,
  'orphan run reconciliation function exists'
);

select ok(
  exists(
    select 1 from cron.job
    where jobname='analysis-run-orphan-reconcile'
      and active
      and command like '%reconcile_orphan_analysis_runs(30)%'
  ),
  'orphan run reconciliation cron is active'
);

do $$
declare
  v_user uuid := '11111111-2222-4333-8444-555555555555'::uuid;
  v_orphan uuid := 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'::uuid;
  v_with_job uuid := 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'::uuid;
  v_fresh uuid := 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa'::uuid;
begin
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_user,'authenticated','authenticated','orphan-reconcile@example.invalid','{"provider":"google","providers":["google"]}'::jsonb,'{}'::jsonb,now(),now());

  insert into public.analysis_runs(id,owner_id,target_date,status,current_step,updated_at)
  values
    (v_orphan,v_user,current_date,'RUNNING','COLLECT',now()-interval '2 hours'),
    (v_with_job,v_user,current_date,'RUNNING','CLEAN',now()-interval '2 hours'),
    (v_fresh,v_user,current_date,'RUNNING','FEATURES',now()-interval '10 minutes');

  insert into public.analysis_jobs(run_id,user_id,status,current_step,updated_at)
  values(v_with_job,v_user,'RUNNING','CLEAN',now()-interval '2 hours');
end $$;

select is(
  public.reconcile_orphan_analysis_runs(30),
  1,
  'only one stale RUNNING run without a job is reconciled'
);

select ok(
  exists(
    select 1 from public.analysis_runs
    where id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'::uuid
      and status='ERROR'
      and current_step='COLLECT'
      and notes->>'orphan_reconcile_reason'='RUNNING_WITHOUT_JOB'
      and notes->>'orphan_previous_step'='COLLECT'
  ),
  'stale orphan is marked ERROR and preserves forensic step metadata'
);

select ok(
  exists(
    select 1 from public.analysis_runs
    where id='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'::uuid and status='RUNNING'
  )
  and exists(
    select 1 from public.analysis_runs
    where id='cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa'::uuid and status='RUNNING'
  ),
  'run with a job and fresh orphan are left untouched'
);

select * from finish();
rollback;