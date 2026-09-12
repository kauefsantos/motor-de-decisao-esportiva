begin;
select plan(19);

select ok(to_regclass('public.governance_domain_owners') is not null,'domain owner registry exists');
select is((select count(*)::integer from public.governance_domain_owners),6,'six governed domains seeded');
select ok(to_regclass('public.metric_definitions') is not null,'metric catalog exists');
select is((select count(*)::integer from public.metric_definitions where status='ACTIVE'),5,'five canonical metrics active');
select is((select formula from public.metric_definitions where metric_key='model_gate' and definition_version='strict70-v1'),'model_probability > 0.70','strict 70 gate definition is canonical');
select is((select is_nullable from information_schema.columns where table_schema='public' and table_name='experimental_bet_tracking' and column_name='decision_policy_version'),'NO','decision policy version is mandatory');
select ok(exists(select 1 from pg_constraint where conname='experimental_bet_tracking_policy_version_check'),'decision policy versions constrained');
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='source_fetches' and column_name='definition_version'),'source fetch lineage includes definition version');
select ok(exists(select 1 from pg_trigger where tgname='trg_source_fetch_catalog' and not tgisinternal),'source fetches enforce catalog');
select ok(exists(select 1 from pg_trigger where tgname='trg_raw_observation_catalog' and not tgisinternal),'raw observations enforce catalog');
select ok(to_regclass('public.governance_change_log') is not null,'governance change log exists');
select is((select count(*)::integer from pg_trigger where tgname like 'trg_audit_%' and not tgisinternal),5,'five governed master-data audit triggers exist');
select ok(exists(select 1 from pg_trigger where tgname='trg_governance_change_log_immutable' and not tgisinternal),'governance history has immutability trigger');
select ok(not has_table_privilege('service_role','public.governance_change_log','UPDATE'),'service role cannot update governance history');
select ok(not has_table_privilege('service_role','public.governance_change_log','DELETE'),'service role cannot delete governance history');
select ok(to_regclass('public.access_reviews') is not null,'access review registry exists');
select is((select count(*)::integer from public.access_reviews where review_period='2026-Q3' and review_status='VERIFIED'),3,'three directly verifiable access surfaces recorded');
select is((select count(*)::integer from public.access_reviews where review_period='2026-Q3' and review_status='REVIEW_REQUIRED'),2,'unverifiable external access surfaces are explicit');
select ok(not has_table_privilege('anon','public.metric_definitions','SELECT') and not has_table_privilege('authenticated','public.access_reviews','SELECT'),'governance tables are not browser-readable');

select * from finish();
rollback;
