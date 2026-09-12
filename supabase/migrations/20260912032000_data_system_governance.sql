-- Data and system governance hardening.
-- Establishes formal ownership, metric/source catalogs, access reviews,
-- policy versioning and immutable administrative change history.

create table if not exists public.governance_domain_owners (
  domain text primary key,
  data_owner text not null,
  technical_owner text not null,
  approval_policy text not null,
  review_cadence_days integer not null check (review_cadence_days > 0),
  active boolean not null default true,
  notes text,
  updated_at timestamptz not null default now()
);

alter table public.governance_domain_owners enable row level security;
revoke all on table public.governance_domain_owners from public, anon, authenticated;
grant select, insert, update on table public.governance_domain_owners to service_role;

insert into public.governance_domain_owners(domain,data_owner,technical_owner,approval_policy,review_cadence_days,notes)
values
  ('sources','Product/Data Owner','Repository Maintainer','Changes require PR, CI and source-catalog review.',90,'External sports-data definitions and lineage.'),
  ('models','Quantitative Model Owner','Repository Maintainer','Changes require tests and point-in-time/OOS evidence where applicable.',90,'Probability models, market policy and decision rules.'),
  ('elo','Quantitative Model Owner','Repository Maintainer','Changes require Elo audit/regression evidence.',90,'Team/league Elo and daily sync.'),
  ('bankroll_analytics','Product/Data Owner','Repository Maintainer','Metric-definition changes require glossary/version update.',90,'Tracking, bankroll and analytics metrics.'),
  ('security_access','System Owner','Repository Maintainer','Quarterly access review required.',90,'Authentication, authorization and administrative access.'),
  ('schema','Data/System Owner','Repository Maintainer','Migration + database regression tests required.',90,'Lovable Cloud/PostgreSQL schema and integrity.')
on conflict(domain) do update set
  data_owner=excluded.data_owner,
  technical_owner=excluded.technical_owner,
  approval_policy=excluded.approval_policy,
  review_cadence_days=excluded.review_cadence_days,
  notes=excluded.notes,
  updated_at=now();

create table if not exists public.metric_definitions (
  metric_key text not null,
  definition_version text not null,
  display_name text not null,
  formula text not null,
  population text not null,
  unit text not null,
  data_owner_domain text not null references public.governance_domain_owners(domain),
  effective_from timestamptz not null,
  effective_to timestamptz,
  status text not null check(status in ('ACTIVE','RETIRED')),
  notes text,
  created_at timestamptz not null default now(),
  primary key(metric_key, definition_version)
);

alter table public.metric_definitions enable row level security;
revoke all on table public.metric_definitions from public, anon, authenticated;
grant select, insert, update on table public.metric_definitions to service_role;

insert into public.metric_definitions(metric_key,definition_version,display_name,formula,population,unit,data_owner_domain,effective_from,status,notes)
values
  ('roi','v1','ROI','total_profit / total_stake','Settled bets with positive stake','ratio','bankroll_analytics','2026-09-06T00:00:00Z','ACTIVE','Null when total stake is zero.'),
  ('hit_rate','v1','Hit rate','wins / (wins + losses)','Decided WIN/LOSS bets only','ratio','bankroll_analytics','2026-09-06T00:00:00Z','ACTIVE','PUSH/VOID/PENDING excluded.'),
  ('clv','v1','Closing line value','entry_odd / closing_odd - 1','Rows with valid entry and closing odds > 1','ratio','bankroll_analytics','2026-09-06T00:00:00Z','ACTIVE','Price-based CLV.'),
  ('max_drawdown','v1','Maximum drawdown','max((peak_bankroll-current_bankroll)/peak_bankroll)','Chronological settled bankroll series','ratio','bankroll_analytics','2026-09-06T00:00:00Z','ACTIVE','Computed from initial bankroll plus settled profit.'),
  ('model_gate','strict70-v1','Model confidence gate','model_probability > 0.70','Current decision-policy population','boolean','models','2026-09-11T20:53:58Z','ACTIVE','70.0% fails; only values strictly above 70% may advance.')
on conflict(metric_key,definition_version) do update set
  display_name=excluded.display_name,
  formula=excluded.formula,
  population=excluded.population,
  unit=excluded.unit,
  data_owner_domain=excluded.data_owner_domain,
  effective_from=excluded.effective_from,
  status=excluded.status,
  notes=excluded.notes;

alter table public.experimental_bet_tracking
  add column if not exists decision_policy_version text;

update public.experimental_bet_tracking
set decision_policy_version = case
  when created_at < '2026-09-11T20:53:58Z'::timestamptz or model_probability <= 0.70
    then 'decision-v1-legacy-pre-strict70'
  else 'decision-v2-strict70'
end
where decision_policy_version is null;

alter table public.experimental_bet_tracking
  alter column decision_policy_version set default 'decision-v2-strict70';
alter table public.experimental_bet_tracking
  alter column decision_policy_version set not null;
alter table public.experimental_bet_tracking
  drop constraint if exists experimental_bet_tracking_policy_version_check;
alter table public.experimental_bet_tracking
  add constraint experimental_bet_tracking_policy_version_check
  check(decision_policy_version in ('decision-v1-legacy-pre-strict70','decision-v2-strict70'));

alter table public.source_definitions add column if not exists provider text;
alter table public.source_definitions add column if not exists data_owner_domain text;
alter table public.source_definitions add column if not exists data_steward text;
alter table public.source_definitions add column if not exists license_or_terms text;
alter table public.source_definitions add column if not exists quality_tier text;
alter table public.source_definitions add column if not exists sla_expectation text;
alter table public.source_definitions add column if not exists reviewed_at timestamptz;
alter table public.source_definitions add column if not exists next_review_at timestamptz;
alter table public.source_definitions add column if not exists governance_status text;

update public.source_definitions set
  provider=coalesce(provider,source),
  data_owner_domain=coalesce(data_owner_domain,'sources'),
  data_steward=coalesce(data_steward,'Repository Maintainer'),
  quality_tier=coalesce(quality_tier,case when configured then 'PRIMARY_OR_ACTIVE' else 'INACTIVE_OR_REFERENCE' end),
  sla_expectation=coalesce(sla_expectation,'Best effort; runtime failures must be explicit.'),
  reviewed_at=coalesce(reviewed_at,now()),
  next_review_at=coalesce(next_review_at,now()+interval '90 days'),
  governance_status=coalesce(governance_status,case when configured then 'ACTIVE' else 'REFERENCE' end);

alter table public.source_definitions alter column data_owner_domain set not null;
alter table public.source_definitions alter column data_steward set not null;
alter table public.source_definitions alter column reviewed_at set not null;
alter table public.source_definitions alter column next_review_at set not null;
alter table public.source_definitions alter column governance_status set not null;
alter table public.source_definitions drop constraint if exists source_definitions_owner_fkey;
alter table public.source_definitions add constraint source_definitions_owner_fkey foreign key(data_owner_domain) references public.governance_domain_owners(domain);
alter table public.source_definitions drop constraint if exists source_definitions_governance_status_check;
alter table public.source_definitions add constraint source_definitions_governance_status_check check(governance_status in ('ACTIVE','REFERENCE','RETIRED'));

insert into public.source_definitions(source,definition_version,configured,notes,metric_definitions,provider,data_owner_domain,data_steward,quality_tier,sla_expectation,reviewed_at,next_review_at,governance_status)
values
 ('five_dollar_bet365_odds','five-dollar-bet365-odds-v1',true,'Bet365 event odds endpoint via 5DollarFootballAPI.','{}'::jsonb,'5DollarFootballAPI','sources','Repository Maintainer','PRIMARY_OR_ACTIVE','Best effort; failures explicit.',now(),now()+interval '90 days','ACTIVE'),
 ('five_dollar_bet365_day_odds','five-dollar-bet365-day-odds-v1',true,'Bet365 day odds endpoint via 5DollarFootballAPI.','{}'::jsonb,'5DollarFootballAPI','sources','Repository Maintainer','PRIMARY_OR_ACTIVE','Best effort; failures explicit.',now(),now()+interval '90 days','ACTIVE'),
 ('five_dollar_standings_card','five-dollar-standings-card-v1',true,'Standings/card support endpoint via 5DollarFootballAPI.','{}'::jsonb,'5DollarFootballAPI','sources','Repository Maintainer','PRIMARY_OR_ACTIVE','Best effort; failures explicit.',now(),now()+interval '90 days','ACTIVE'),
 ('five_dollar_standings_corner','five-dollar-standings-corner-v1',true,'Standings/corner support endpoint via 5DollarFootballAPI.','{}'::jsonb,'5DollarFootballAPI','sources','Repository Maintainer','PRIMARY_OR_ACTIVE','Best effort; failures explicit.',now(),now()+interval '90 days','ACTIVE')
on conflict(source,definition_version) do update set
 configured=excluded.configured, notes=excluded.notes, provider=excluded.provider,
 data_owner_domain=excluded.data_owner_domain, data_steward=excluded.data_steward,
 quality_tier=excluded.quality_tier, sla_expectation=excluded.sla_expectation,
 reviewed_at=excluded.reviewed_at, next_review_at=excluded.next_review_at,
 governance_status=excluded.governance_status;

alter table public.source_fetches add column if not exists definition_version text;

update public.source_fetches f
set definition_version = s.definition_version
from public.source_definitions s
where f.definition_version is null and s.source=f.source;

create or replace function public.enforce_source_catalog()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_version text;
begin
  if new.definition_version is null then
    select s.definition_version into v_version
    from public.source_definitions s
    where s.source=new.source and s.governance_status='ACTIVE'
    order by s.reviewed_at desc limit 1;
    if v_version is null then
      raise exception 'source % is not registered as ACTIVE in source_definitions', new.source;
    end if;
    new.definition_version := v_version;
  end if;
  if not exists(select 1 from public.source_definitions s where s.source=new.source and s.definition_version=new.definition_version) then
    raise exception 'source/version %/% is not registered', new.source, new.definition_version;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_source_catalog() from public, anon, authenticated;
grant execute on function public.enforce_source_catalog() to service_role;

drop trigger if exists trg_source_fetch_catalog on public.source_fetches;
create trigger trg_source_fetch_catalog before insert or update of source,definition_version
on public.source_fetches for each row execute function public.enforce_source_catalog();

drop trigger if exists trg_raw_observation_catalog on public.raw_observations;
create trigger trg_raw_observation_catalog before insert or update of source,definition_version
on public.raw_observations for each row execute function public.enforce_source_catalog();

alter table public.source_fetches drop constraint if exists source_fetches_source_definition_fkey;
alter table public.source_fetches add constraint source_fetches_source_definition_fkey
 foreign key(source,definition_version) references public.source_definitions(source,definition_version) not valid;

alter table public.raw_observations drop constraint if exists raw_observations_source_definition_fkey;
alter table public.raw_observations add constraint raw_observations_source_definition_fkey
 foreign key(source,definition_version) references public.source_definitions(source,definition_version) not valid;

create table if not exists public.governance_change_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_key text,
  operation text not null check(operation in ('INSERT','UPDATE','DELETE')),
  actor_user_id uuid,
  actor_db_role text not null,
  changed_at timestamptz not null default now(),
  before_data jsonb,
  after_data jsonb,
  context jsonb not null default '{}'::jsonb
);

alter table public.governance_change_log enable row level security;
revoke all on table public.governance_change_log from public, anon, authenticated;
revoke update, delete, truncate on table public.governance_change_log from service_role;
grant select, insert on table public.governance_change_log to service_role;

after insert or update or delete on public.source_definitions;

create or replace function public.audit_governed_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare oldj jsonb; newj jsonb; key_text text;
begin
  oldj := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  newj := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  key_text := coalesce(newj->>'id',oldj->>'id',newj->>'source',oldj->>'source',newj->>'domain',oldj->>'domain',newj->>'metric_key',oldj->>'metric_key');
  insert into public.governance_change_log(table_name,record_key,operation,actor_user_id,actor_db_role,before_data,after_data,context)
  values(tg_table_name,key_text,tg_op,auth.uid(),current_user,oldj,newj,jsonb_build_object('application_name',current_setting('application_name',true)));
  return coalesce(new,old);
end;
$$;

revoke all on function public.audit_governed_change() from public, anon, authenticated;
grant execute on function public.audit_governed_change() to service_role;

drop trigger if exists trg_audit_source_definitions on public.source_definitions;
create trigger trg_audit_source_definitions after insert or update or delete on public.source_definitions for each row execute function public.audit_governed_change();
drop trigger if exists trg_audit_model_versions on public.model_versions;
create trigger trg_audit_model_versions after insert or update or delete on public.model_versions for each row execute function public.audit_governed_change();
drop trigger if exists trg_audit_bankroll_config on public.experimental_bankroll_config;
create trigger trg_audit_bankroll_config after insert or update or delete on public.experimental_bankroll_config for each row execute function public.audit_governed_change();
drop trigger if exists trg_audit_metric_definitions on public.metric_definitions;
create trigger trg_audit_metric_definitions after insert or update or delete on public.metric_definitions for each row execute function public.audit_governed_change();
drop trigger if exists trg_audit_domain_owners on public.governance_domain_owners;
create trigger trg_audit_domain_owners after insert or update or delete on public.governance_domain_owners for each row execute function public.audit_governed_change();

create table if not exists public.access_reviews (
  id uuid primary key default gen_random_uuid(),
  review_period text not null,
  system_name text not null,
  account_ref text not null,
  role_name text not null,
  evidence_source text not null,
  review_status text not null check(review_status in ('VERIFIED','REVIEW_REQUIRED','REMOVED')),
  reviewed_at timestamptz not null,
  reviewed_by_domain text not null references public.governance_domain_owners(domain),
  next_review_at timestamptz not null,
  notes text,
  unique(review_period,system_name,account_ref)
);

alter table public.access_reviews enable row level security;
revoke all on table public.access_reviews from public, anon, authenticated;
grant select, insert, update on table public.access_reviews to service_role;

insert into public.access_reviews(review_period,system_name,account_ref,role_name,evidence_source,review_status,reviewed_at,reviewed_by_domain,next_review_at,notes)
values
 ('2026-Q3','GitHub','kauefsantos','Repository admin','GitHub collaborator-permission API','VERIFIED',now(),'security_access',now()+interval '90 days','Admin permission verified during governance remediation.'),
 ('2026-Q3','Lovable','workspace-owner','Workspace owner','Lovable workspace membership','VERIFIED',now(),'security_access',now()+interval '90 days','Owner role verified; project itself is private in workspace.'),
 ('2026-Q3','Application','single-active-user','Authorized application user','Lovable Cloud auth/users and ownership checks','VERIFIED',now(),'security_access',now()+interval '90 days','Exactly one active application user at review time.'),
 ('2026-Q3','Google OAuth','oauth-admins','Administrative access','External provider console','REVIEW_REQUIRED',now(),'security_access',now()+interval '30 days','Provider-side admin list is not exposed to this audit connection.'),
 ('2026-Q3','External API credentials','credential-owners','Secret/credential ownership','External provider consoles/runtime secrets','REVIEW_REQUIRED',now(),'security_access',now()+interval '30 days','Ownership must be reconciled in provider consoles.')
on conflict(review_period,system_name,account_ref) do update set
 role_name=excluded.role_name,evidence_source=excluded.evidence_source,review_status=excluded.review_status,
 reviewed_at=excluded.reviewed_at,reviewed_by_domain=excluded.reviewed_by_domain,next_review_at=excluded.next_review_at,notes=excluded.notes;

create or replace view public.access_review_status as
select system_name,account_ref,role_name,review_status,reviewed_at,next_review_at,
       (next_review_at < now()) as overdue,notes
from public.access_reviews;

revoke all on public.access_review_status from public,anon,authenticated;
grant select on public.access_review_status to service_role;

insert into public.app_schema_releases(version,migration_name,notes)
values('20260912-data-system-governance','data_system_governance','Formal ownership, metric/source catalogs, decision-policy versioning, audit log and access reviews.')
on conflict(version) do update set migration_name=excluded.migration_name,notes=excluded.notes;
