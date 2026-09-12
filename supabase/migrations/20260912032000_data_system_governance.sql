-- Formal data/system governance controls.

create table public.governance_domain_owners (
  domain text primary key,
  data_owner text not null,
  technical_owner text not null,
  approval_policy text not null,
  review_cadence_days integer not null check(review_cadence_days > 0),
  updated_at timestamptz not null default now()
);
alter table public.governance_domain_owners enable row level security;
revoke all on public.governance_domain_owners from public,anon,authenticated;
grant select,insert,update on public.governance_domain_owners to service_role;
insert into public.governance_domain_owners values
 ('sources','Product/Data Owner','Repository Maintainer','PR + CI + source catalog review',90,now()),
 ('models','Quantitative Model Owner','Repository Maintainer','Tests + point-in-time/OOS evidence where applicable',90,now()),
 ('elo','Quantitative Model Owner','Repository Maintainer','Elo regression/audit evidence',90,now()),
 ('bankroll_analytics','Product/Data Owner','Repository Maintainer','Metric glossary/version update',90,now()),
 ('security_access','System Owner','Repository Maintainer','Quarterly access review',90,now()),
 ('schema','Data/System Owner','Repository Maintainer','Migration + database regression tests',90,now());

create table public.metric_definitions (
  metric_key text not null,
  definition_version text not null,
  display_name text not null,
  formula text not null,
  population text not null,
  unit text not null,
  data_owner_domain text not null references public.governance_domain_owners(domain),
  effective_from timestamptz not null,
  status text not null check(status in ('ACTIVE','RETIRED')),
  notes text,
  primary key(metric_key,definition_version)
);
alter table public.metric_definitions enable row level security;
revoke all on public.metric_definitions from public,anon,authenticated;
grant select,insert,update on public.metric_definitions to service_role;
insert into public.metric_definitions values
 ('roi','v1','ROI','total_profit / total_stake','Settled bets with positive stake','ratio','bankroll_analytics','2026-09-06T00:00:00Z','ACTIVE','Null when stake is zero'),
 ('hit_rate','v1','Hit rate','wins / (wins + losses)','WIN/LOSS only','ratio','bankroll_analytics','2026-09-06T00:00:00Z','ACTIVE','PUSH/VOID/PENDING excluded'),
 ('clv','v1','CLV','entry_odd / closing_odd - 1','Valid entry/closing odds > 1','ratio','bankroll_analytics','2026-09-06T00:00:00Z','ACTIVE','Price CLV'),
 ('max_drawdown','v1','Maximum drawdown','max((peak-current)/peak)','Chronological settled bankroll','ratio','bankroll_analytics','2026-09-06T00:00:00Z','ACTIVE','Based on settled profit'),
 ('model_gate','strict70-v1','Model confidence gate','model_probability > 0.70','Current decision policy','boolean','models','2026-09-11T20:53:58Z','ACTIVE','70.0% fails');

alter table public.experimental_bet_tracking add column decision_policy_version text;
update public.experimental_bet_tracking set decision_policy_version = case
 when created_at < '2026-09-11T20:53:58Z'::timestamptz or model_probability <= 0.70 then 'decision-v1-legacy-pre-strict70'
 else 'decision-v2-strict70' end;
alter table public.experimental_bet_tracking alter column decision_policy_version set default 'decision-v2-strict70';
alter table public.experimental_bet_tracking alter column decision_policy_version set not null;
alter table public.experimental_bet_tracking add constraint experimental_bet_tracking_policy_version_check
 check(decision_policy_version in ('decision-v1-legacy-pre-strict70','decision-v2-strict70'));

alter table public.source_definitions add column provider text;
alter table public.source_definitions add column data_owner_domain text references public.governance_domain_owners(domain);
alter table public.source_definitions add column data_steward text;
alter table public.source_definitions add column license_or_terms text;
alter table public.source_definitions add column quality_tier text;
alter table public.source_definitions add column sla_expectation text;
alter table public.source_definitions add column reviewed_at timestamptz;
alter table public.source_definitions add column next_review_at timestamptz;
alter table public.source_definitions add column governance_status text check(governance_status in ('ACTIVE','REFERENCE','RETIRED'));
update public.source_definitions set provider=source,data_owner_domain='sources',data_steward='Repository Maintainer',
 quality_tier=case when configured then 'PRIMARY_OR_ACTIVE' else 'INACTIVE_OR_REFERENCE' end,
 sla_expectation='Best effort; runtime failures must be explicit.',reviewed_at=now(),next_review_at=now()+interval '90 days',
 governance_status=case when configured then 'ACTIVE' else 'REFERENCE' end;
alter table public.source_definitions alter column data_owner_domain set not null;
alter table public.source_definitions alter column data_steward set not null;
alter table public.source_definitions alter column reviewed_at set not null;
alter table public.source_definitions alter column next_review_at set not null;
alter table public.source_definitions alter column governance_status set not null;

insert into public.source_definitions(source,definition_version,configured,notes,metric_definitions,provider,data_owner_domain,data_steward,quality_tier,sla_expectation,reviewed_at,next_review_at,governance_status) values
 ('five_dollar_bet365_odds','five-dollar-bet365-odds-v1',true,'Bet365 event odds via 5DollarFootballAPI','{}','5DollarFootballAPI','sources','Repository Maintainer','PRIMARY_OR_ACTIVE','Best effort; failures explicit',now(),now()+interval '90 days','ACTIVE'),
 ('five_dollar_bet365_day_odds','five-dollar-bet365-day-odds-v1',true,'Bet365 day odds via 5DollarFootballAPI','{}','5DollarFootballAPI','sources','Repository Maintainer','PRIMARY_OR_ACTIVE','Best effort; failures explicit',now(),now()+interval '90 days','ACTIVE'),
 ('five_dollar_standings_card','five-dollar-standings-card-v1',true,'Card support endpoint','{}','5DollarFootballAPI','sources','Repository Maintainer','PRIMARY_OR_ACTIVE','Best effort; failures explicit',now(),now()+interval '90 days','ACTIVE'),
 ('five_dollar_standings_corner','five-dollar-standings-corner-v1',true,'Corner support endpoint','{}','5DollarFootballAPI','sources','Repository Maintainer','PRIMARY_OR_ACTIVE','Best effort; failures explicit',now(),now()+interval '90 days','ACTIVE');

alter table public.source_fetches add column definition_version text;
update public.source_fetches f set definition_version=s.definition_version from public.source_definitions s where s.source=f.source;

create function public.enforce_source_catalog() returns trigger language plpgsql security definer set search_path='' as $$
declare v text;
begin
 if new.definition_version is null then
   select definition_version into v from public.source_definitions where source=new.source and governance_status='ACTIVE' order by reviewed_at desc limit 1;
   if v is null then raise exception 'unregistered source: %',new.source; end if;
   new.definition_version:=v;
 end if;
 if not exists(select 1 from public.source_definitions where source=new.source and definition_version=new.definition_version) then
   raise exception 'unregistered source/version: %/%',new.source,new.definition_version;
 end if;
 return new;
end$$;
revoke all on function public.enforce_source_catalog() from public,anon,authenticated;
grant execute on function public.enforce_source_catalog() to service_role;
create trigger trg_source_fetch_catalog before insert or update of source,definition_version on public.source_fetches for each row execute function public.enforce_source_catalog();
create trigger trg_raw_observation_catalog before insert or update of source,definition_version on public.raw_observations for each row execute function public.enforce_source_catalog();
alter table public.source_fetches add constraint source_fetches_source_definition_fkey foreign key(source,definition_version) references public.source_definitions(source,definition_version) not valid;
alter table public.raw_observations add constraint raw_observations_source_definition_fkey foreign key(source,definition_version) references public.source_definitions(source,definition_version) not valid;

create table public.governance_change_log (
 id bigint generated always as identity primary key, table_name text not null, record_key text,
 operation text not null check(operation in ('INSERT','UPDATE','DELETE')), actor_user_id uuid, actor_db_role text not null,
 changed_at timestamptz not null default now(), before_data jsonb, after_data jsonb, context jsonb not null default '{}'
);
alter table public.governance_change_log enable row level security;
revoke all on public.governance_change_log from public,anon,authenticated;
grant select,insert on public.governance_change_log to service_role;

create function public.audit_governed_change() returns trigger language plpgsql security definer set search_path='' as $$
declare o jsonb; n jsonb; k text;
begin
 o:=case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
 n:=case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
 k:=coalesce(n->>'id',o->>'id',n->>'source',o->>'source',n->>'domain',o->>'domain',n->>'metric_key',o->>'metric_key');
 insert into public.governance_change_log(table_name,record_key,operation,actor_user_id,actor_db_role,before_data,after_data,context)
 values(tg_table_name,k,tg_op,auth.uid(),current_user,o,n,jsonb_build_object('application_name',current_setting('application_name',true)));
 if tg_op='DELETE' then return old; end if; return new;
end$$;
revoke all on function public.audit_governed_change() from public,anon,authenticated;
grant execute on function public.audit_governed_change() to service_role;
create trigger trg_audit_source_definitions after insert or update or delete on public.source_definitions for each row execute function public.audit_governed_change();
create trigger trg_audit_model_versions after insert or update or delete on public.model_versions for each row execute function public.audit_governed_change();
create trigger trg_audit_bankroll_config after insert or update or delete on public.experimental_bankroll_config for each row execute function public.audit_governed_change();
create trigger trg_audit_metric_definitions after insert or update or delete on public.metric_definitions for each row execute function public.audit_governed_change();
create trigger trg_audit_domain_owners after insert or update or delete on public.governance_domain_owners for each row execute function public.audit_governed_change();

create table public.access_reviews (
 id uuid primary key default gen_random_uuid(), review_period text not null, system_name text not null, account_ref text not null,
 role_name text not null, evidence_source text not null, review_status text not null check(review_status in ('VERIFIED','REVIEW_REQUIRED','REMOVED')),
 reviewed_at timestamptz not null, reviewed_by_domain text not null references public.governance_domain_owners(domain), next_review_at timestamptz not null,
 notes text, unique(review_period,system_name,account_ref)
);
alter table public.access_reviews enable row level security;
revoke all on public.access_reviews from public,anon,authenticated;
grant select,insert,update on public.access_reviews to service_role;
insert into public.access_reviews(review_period,system_name,account_ref,role_name,evidence_source,review_status,reviewed_at,reviewed_by_domain,next_review_at,notes) values
 ('2026-Q3','GitHub','kauefsantos','Repository admin','GitHub collaborator permission API','VERIFIED',now(),'security_access',now()+interval '90 days','Admin verified'),
 ('2026-Q3','Lovable','workspace-owner','Workspace owner','Lovable workspace membership','VERIFIED',now(),'security_access',now()+interval '90 days','Owner verified; project private'),
 ('2026-Q3','Application','single-active-user','Authorized application user','Lovable Cloud auth/ownership checks','VERIFIED',now(),'security_access',now()+interval '90 days','One active app user'),
 ('2026-Q3','Google OAuth','oauth-admins','Administrative access','External provider console','REVIEW_REQUIRED',now(),'security_access',now()+interval '30 days','Provider admin list unavailable to connector'),
 ('2026-Q3','External API credentials','credential-owners','Credential ownership','Provider consoles/runtime secrets','REVIEW_REQUIRED',now(),'security_access',now()+interval '30 days','Must be reconciled in provider consoles');
create view public.access_review_status as select system_name,account_ref,role_name,review_status,reviewed_at,next_review_at,next_review_at<now() overdue,notes from public.access_reviews;
revoke all on public.access_review_status from public,anon,authenticated;
grant select on public.access_review_status to service_role;

insert into public.app_schema_releases(version,migration_name,notes) values
 ('20260912-data-system-governance','data_system_governance','Ownership, metric/source catalogs, policy versioning, change log and access reviews.');
