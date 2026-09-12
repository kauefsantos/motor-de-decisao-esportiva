begin;
select plan(15);

select ok(to_regclass('public.privacy_processing_activities') is not null,'privacy processing register exists');
select is((select count(*)::integer from public.privacy_processing_activities where active),8,'eight active processing activities are registered');
select ok(to_regclass('public.privacy_retention_policies') is not null,'privacy retention policy registry exists');
select is((select count(*)::integer from public.privacy_retention_policies where active),4,'four active retention policies are registered');

select ok(
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='run_privacy_retention_cleanup'),
  'retention cleanup function exists'
);
select ok(
  exists(select 1 from cron.job where jobname='privacy-retention-daily' and active),
  'daily privacy retention job is scheduled'
);
select ok(
  not has_function_privilege('authenticated','public.run_privacy_retention_cleanup()','EXECUTE'),
  'authenticated users cannot run retention cleanup'
);
select ok(
  not has_function_privilege('authenticated','public.erase_user_application_data(uuid)','EXECUTE'),
  'authenticated users cannot invoke privileged erasure directly'
);
select ok(
  exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='cleanup_deleted_app_user' and not tgisinternal),
  'auth user deletion has application cleanup trigger'
);
select is(
  (select count(*)::integer from pg_trigger where tgname in ('minimize_auth_user_metadata','minimize_identity_metadata') and not tgisinternal),
  2,
  'OAuth profile minimization triggers exist'
);
select ok(
  not exists(select 1 from auth.users where coalesce(raw_user_meta_data,'{}'::jsonb) ?| array['avatar_url','full_name','name','picture']),
  'stored auth user metadata contains no unused display profile fields'
);
select ok(
  not exists(select 1 from auth.identities where coalesce(identity_data,'{}'::jsonb) ?| array['avatar_url','full_name','name','picture']),
  'stored provider identity metadata contains no unused display profile fields'
);
select ok(
  not has_table_privilege('authenticated','public.privacy_processing_activities','SELECT'),
  'processing registry is not browser-readable'
);
select lives_ok(
  $$select public.run_privacy_retention_cleanup()$$,
  'retention cleanup executes successfully'
);
select lives_ok(
  $outer$
  do $test$
  declare
    v_user uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
    v_run uuid;
  begin
    insert into public.analysis_runs(owner_id,status) values(v_user,'CREATED') returning id into v_run;
    perform public.erase_user_application_data(v_user);
    if exists(select 1 from public.analysis_runs where id=v_run) then
      raise exception 'owned run was not erased';
    end if;
  end
  $test$
  $outer$,
  'account erasure removes owned runs and their cascaded data'
);

select * from finish();
rollback;
