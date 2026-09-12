-- Database integrity hardening.
-- Goals: idempotent raw ingestion, cross-run referential integrity,
-- defensive CHECK constraints, source registry consistency and explicit schema ledger.

create table if not exists public.app_schema_releases (
  version text primary key,
  migration_name text not null,
  git_sha text,
  checksum text,
  applied_at timestamptz not null default now(),
  notes text
);

alter table public.app_schema_releases enable row level security;
revoke all on table public.app_schema_releases from public, anon, authenticated;
grant all on table public.app_schema_releases to service_role;

insert into public.app_schema_releases(version, migration_name, notes)
values
  ('20260911-baseline', 'lovable_cloud_current_baseline', 'Baseline explicito do schema vivo antes do hardening de integridade.'),
  ('20260912-integrity-hardening', 'database_integrity_hardening', 'Idempotencia, FKs compostas, checks e governanca de schema.')
on conflict (version) do update
set migration_name = excluded.migration_name,
    notes = excluded.notes;

alter table public.raw_observations add column if not exists observation_key text;

create or replace function public.raw_observation_identity(
  p_run_id uuid,
  p_match_id uuid,
  p_source text,
  p_metric text,
  p_raw_value jsonb,
  p_observed_at timestamptz,
  p_definition_version text
) returns text
language sql
immutable
set search_path = ''
as $$
  select md5(concat_ws('|',
    coalesce(p_run_id::text, ''),
    coalesce(p_match_id::text, ''),
    coalesce(p_source, ''),
    coalesce(p_metric, ''),
    coalesce(p_definition_version, ''),
    coalesce(p_raw_value->>'fixtureId', p_raw_value->>'externalMatchId', ''),
    coalesce(p_raw_value->>'teamId', p_raw_value->>'teamExternalId', ''),
    coalesce(p_raw_value->>'opponentId', ''),
    coalesce(p_raw_value->>'teamSideInFixture', p_raw_value->>'teamScope', ''),
    coalesce(p_raw_value->>'value', ''),
    coalesce(p_raw_value->>'sourceLabel', p_raw_value->>'metricLabelRaw', ''),
    coalesce(to_char(p_observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), '')
  ));
$$;

create or replace function public.set_raw_observation_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.observation_key := public.raw_observation_identity(
    new.run_id, new.match_id, new.source, new.metric,
    new.raw_value, new.observed_at, new.definition_version
  );
  return new;
end;
$$;

update public.raw_observations
set observation_key = public.raw_observation_identity(
  run_id, match_id, source, metric, raw_value, observed_at, definition_version
)
where observation_key is null;

create temporary table integrity_affected_runs on commit drop as
select distinct run_id
from (
  select run_id, observation_key, count(*) as copies
  from public.raw_observations
  group by run_id, observation_key
  having count(*) > 1
) d;

delete from public.raw_observations r
using (
  select id,
         row_number() over (
           partition by run_id, observation_key
           order by fetched_at asc, id asc
         ) as rn
  from public.raw_observations
) d
where r.id = d.id and d.rn > 1;

alter table public.raw_observations alter column observation_key set not null;
create unique index if not exists uq_raw_observations_run_observation_key
  on public.raw_observations(run_id, observation_key);

drop trigger if exists trg_set_raw_observation_key on public.raw_observations;
create trigger trg_set_raw_observation_key
before insert or update of run_id, match_id, source, metric, raw_value, observed_at, definition_version
on public.raw_observations
for each row execute function public.set_raw_observation_key();

-- Defensive idempotence: if older application code retries the same observation,
-- convert the conflicting insert into a no-op instead of failing the whole batch.
create or replace function public.ignore_duplicate_raw_observation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.observation_key := public.raw_observation_identity(
    new.run_id, new.match_id, new.source, new.metric,
    new.raw_value, new.observed_at, new.definition_version
  );
  if exists (
    select 1 from public.raw_observations r
    where r.run_id = new.run_id and r.observation_key = new.observation_key
  ) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ignore_duplicate_raw_observation on public.raw_observations;
create trigger trg_ignore_duplicate_raw_observation
before insert on public.raw_observations
for each row execute function public.ignore_duplicate_raw_observation();

-- Rebuild normalized features only for historically affected runs.
delete from public.normalized_match_stats n
using integrity_affected_runs a
where n.run_id = a.run_id;

with valid as (
  select r.*,
         split_part(r.metric, ':', 1) as scope_key,
         substring(r.metric from position(':' in r.metric) + 1) as canonical_metric,
         (r.raw_value->>'value')::numeric as numeric_value
  from public.raw_observations r
  join integrity_affected_runs a on a.run_id = r.run_id
  where position(':' in r.metric) > 0
    and r.raw_value ? 'value'
    and (r.raw_value->>'value') ~ '^-?[0-9]+([.][0-9]+)?$'
    and coalesce((r.raw_value->>'contractCompatible')::boolean, false) = true
), source_means as (
  select run_id, match_id, scope_key, canonical_metric, source,
         avg(numeric_value) as source_avg,
         count(*) as source_n
  from valid
  group by run_id, match_id, scope_key, canonical_metric, source
), source_summary as (
  select run_id, match_id, scope_key, canonical_metric,
         count(*) as source_count,
         min(source_avg) as min_avg,
         max(source_avg) as max_avg,
         string_agg(source, '+' order by source) as sources,
         jsonb_agg(jsonb_build_object('source', source, 'value', source_avg, 'sampleSize', source_n) order by source) as per_source
  from source_means
  group by run_id, match_id, scope_key, canonical_metric
), agg as (
  select v.run_id, v.match_id, v.scope_key, v.canonical_metric,
         avg(v.numeric_value) as normalized_value,
         count(*) as sample_size,
         min(v.definition_version) as definition_version,
         jsonb_agg(jsonb_build_object(
           'rawObservationId', v.id,
           'source', v.source,
           'fetchedAt', v.fetched_at,
           'rawValue', v.numeric_value,
           'normalizedValue', v.numeric_value,
           'canonicalMetric', v.canonical_metric,
           'metricLabelRaw', coalesce(v.raw_value->>'metricLabelRaw', v.raw_value->>'sourceLabel'),
           'sourceLabel', v.raw_value->>'sourceLabel',
           'statScope', v.raw_value->>'statScope',
           'externalMatchId', v.raw_value->>'externalMatchId',
           'observedDate', v.raw_value->>'fixtureDate',
           'predictionAt', v.raw_value->>'predictionAt',
           'definitionVersion', v.definition_version,
           'note', v.raw_value->>'note'
         ) order by v.observed_at, v.id) as observations
  from valid v
  group by v.run_id, v.match_id, v.scope_key, v.canonical_metric
)
insert into public.normalized_match_stats(
  run_id, match_id, scope, metric, normalized_value, sample_size,
  source, definition_version, lineage
)
select a.run_id, a.match_id, a.scope_key, a.canonical_metric,
       a.normalized_value, a.sample_size, s.sources, a.definition_version,
       jsonb_build_object(
         'observations', a.observations,
         'crossCheck', jsonb_build_object(
           'status', case
             when s.source_count < 2 then 'SINGLE_SOURCE'
             when abs(s.max_avg - s.min_avg) <= 0.1 then 'CROSS_SOURCE_CONFIRMED'
             else 'SOURCE_CONFLICT'
           end,
           'perSource', s.per_source
         )
       )
from agg a
join source_summary s using(run_id, match_id, scope_key, canonical_metric);

with ranked as (
  select id,
         row_number() over (
           partition by match_id, source
           order by created_at desc, id desc
         ) as rn
  from public.match_external_ids
)
delete from public.match_external_ids m
using ranked r
where m.id = r.id and r.rn > 1;

alter table public.match_external_ids drop constraint if exists match_external_ids_match_source_key;
alter table public.match_external_ids add constraint match_external_ids_match_source_key unique(match_id, source);

create or replace function public.upsert_match_external_id_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.match_id::text || ':' || new.source, 0));
  update public.match_external_ids
  set external_id = new.external_id,
      confidence = new.confidence,
      created_at = coalesce(new.created_at, now())
  where match_id = new.match_id and source = new.source;
  if found then return null; end if;
  return new;
end;
$$;

drop trigger if exists trg_match_external_id_guard on public.match_external_ids;
create trigger trg_match_external_id_guard
before insert on public.match_external_ids
for each row execute function public.upsert_match_external_id_guard();

create unique index if not exists uq_source_definitions_source_version
  on public.source_definitions(source, definition_version);

create or replace function public.source_definition_current_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.source, 0));
  update public.source_definitions
  set definition_version = new.definition_version,
      metric_definitions = new.metric_definitions,
      configured = new.configured,
      notes = new.notes
  where source = new.source and definition_version is distinct from new.definition_version;
  if found then return null; end if;
  return new;
end;
$$;

drop trigger if exists trg_source_definition_current_guard on public.source_definitions;
create trigger trg_source_definition_current_guard
before insert on public.source_definitions
for each row execute function public.source_definition_current_guard();

insert into public.source_definitions(source, definition_version, configured, notes, metric_definitions)
values (
  'five_dollar_football',
  'five-dollar-v1',
  true,
  '5DollarFootballAPI nativa v1 — provedor principal experimental.',
  '{"provider":"five_dollar","metrics":{"goals_for":"placar final relativo ao time","goals_against":"placar final do adversário","corners_taken_for":"corners.home/away relativo ao time","corners_taken_against":"corners.home/away do adversário","cards_yellow_raw":"bruto; não libera mercado de cartões","cards_red_raw":"bruto; não libera mercado de cartões"}}'::jsonb
)
on conflict(source, definition_version) do update
set configured = excluded.configured,
    notes = excluded.notes,
    metric_definitions = excluded.metric_definitions;

create unique index if not exists uq_matches_run_id_id on public.matches(run_id, id);
create unique index if not exists uq_market_candidates_run_id_id on public.market_candidates(run_id, id);
create unique index if not exists uq_value_evaluations_run_id_id on public.value_evaluations(run_id, id);

alter table public.market_candidates drop constraint if exists market_candidates_run_match_fkey;
alter table public.market_candidates add constraint market_candidates_run_match_fkey foreign key(run_id, match_id) references public.matches(run_id, id) on delete cascade;
alter table public.model_predictions drop constraint if exists model_predictions_run_match_fkey;
alter table public.model_predictions add constraint model_predictions_run_match_fkey foreign key(run_id, match_id) references public.matches(run_id, id) on delete cascade;
alter table public.raw_observations drop constraint if exists raw_observations_run_match_fkey;
alter table public.raw_observations add constraint raw_observations_run_match_fkey foreign key(run_id, match_id) references public.matches(run_id, id) on delete cascade;
alter table public.normalized_match_stats drop constraint if exists normalized_match_stats_run_match_fkey;
alter table public.normalized_match_stats add constraint normalized_match_stats_run_match_fkey foreign key(run_id, match_id) references public.matches(run_id, id) on delete cascade;
alter table public.source_fetches drop constraint if exists source_fetches_run_match_fkey;
alter table public.source_fetches add constraint source_fetches_run_match_fkey foreign key(run_id, match_id) references public.matches(run_id, id) on delete cascade;
alter table public.elo_prediction_context drop constraint if exists elo_prediction_context_run_match_fkey;
alter table public.elo_prediction_context add constraint elo_prediction_context_run_match_fkey foreign key(run_id, match_id) references public.matches(run_id, id) on delete cascade;
alter table public.user_odds drop constraint if exists user_odds_run_candidate_fkey;
alter table public.user_odds add constraint user_odds_run_candidate_fkey foreign key(run_id, candidate_id) references public.market_candidates(run_id, id) on delete cascade;
alter table public.value_evaluations drop constraint if exists value_evaluations_run_candidate_fkey;
alter table public.value_evaluations add constraint value_evaluations_run_candidate_fkey foreign key(run_id, candidate_id) references public.market_candidates(run_id, id) on delete cascade;
alter table public.final_selections drop constraint if exists final_selections_run_evaluation_fkey;
alter table public.final_selections add constraint final_selections_run_evaluation_fkey foreign key(run_id, evaluation_id) references public.value_evaluations(run_id, id) on delete cascade;
alter table public.experimental_bet_tracking drop constraint if exists experimental_bet_tracking_run_match_fkey;
alter table public.experimental_bet_tracking add constraint experimental_bet_tracking_run_match_fkey foreign key(run_id, match_id) references public.matches(run_id, id) on delete cascade;
alter table public.experimental_odds_snapshots drop constraint if exists experimental_odds_snapshots_run_match_fkey;
alter table public.experimental_odds_snapshots add constraint experimental_odds_snapshots_run_match_fkey foreign key(run_id, match_id) references public.matches(run_id, id) on delete cascade;

create or replace function public.enforce_experimental_eval_match_run()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.match_id is not null
     and not exists (select 1 from public.matches m where m.id = new.match_id and m.run_id = new.run_id) then
    raise exception 'experimental_value_evaluations match_id belongs to another run';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_experimental_eval_match_run on public.experimental_value_evaluations;
create trigger trg_experimental_eval_match_run
before insert or update of run_id, match_id
on public.experimental_value_evaluations
for each row execute function public.enforce_experimental_eval_match_run();

alter table public.analysis_runs drop constraint if exists analysis_runs_nonnegative_counts_check;
alter table public.analysis_runs add constraint analysis_runs_nonnegative_counts_check check(matches_total >= 0 and matches_resolved >= 0 and matches_failed >= 0 and candidates_published >= 0 and candidates_blocked >= 0 and selections_count >= 0);
alter table public.matches drop constraint if exists matches_resolver_confidence_check;
alter table public.matches add constraint matches_resolver_confidence_check check(resolver_confidence is null or resolver_confidence between 0 and 1);
alter table public.model_predictions drop constraint if exists model_predictions_probability_range_check;
alter table public.model_predictions add constraint model_predictions_probability_range_check check((model_probability is null or model_probability between 0 and 1) and (p_cal is null or p_cal between 0 and 1) and (conservative_probability is null or conservative_probability between 0 and 1));
alter table public.market_candidates drop constraint if exists market_candidates_probability_range_check;
alter table public.market_candidates add constraint market_candidates_probability_range_check check((p_cal is null or p_cal between 0 and 1) and (p_cons is null or p_cons between 0 and 1) and (confidence_score is null or confidence_score between 0 and 1) and (data_quality_score is null or data_quality_score between 0 and 1) and (sample_reliability is null or sample_reliability between 0 and 1) and (stability is null or stability between 0 and 1));
alter table public.user_odds drop constraint if exists user_odds_odd_check;
alter table public.user_odds add constraint user_odds_odd_check check(odd > 1);
alter table public.value_evaluations drop constraint if exists value_evaluations_odd_check;
alter table public.value_evaluations add constraint value_evaluations_odd_check check(odd > 1);
alter table public.value_evaluations drop constraint if exists value_evaluations_probability_check;
alter table public.value_evaluations add constraint value_evaluations_probability_check check(implied_probability is null or implied_probability between 0 and 1);
alter table public.final_selections drop constraint if exists final_selections_rank_check;
alter table public.final_selections add constraint final_selections_rank_check check(rank between 1 and 3);
alter table public.uploaded_files drop constraint if exists uploaded_files_counts_check;
alter table public.uploaded_files add constraint uploaded_files_counts_check check(row_count >= 0 and invalid_row_count >= 0 and invalid_row_count <= row_count);
alter table public.normalized_match_stats drop constraint if exists normalized_match_stats_sample_size_check;
alter table public.normalized_match_stats add constraint normalized_match_stats_sample_size_check check(sample_size is null or sample_size >= 0);
alter table public.source_fetches drop constraint if exists source_fetches_attempt_check;
alter table public.source_fetches add constraint source_fetches_attempt_check check(attempt >= 1);
alter table public.analysis_jobs drop constraint if exists analysis_jobs_attempts_check;
alter table public.analysis_jobs add constraint analysis_jobs_attempts_check check(attempts >= 0);
alter table public.elo_team_ratings drop constraint if exists elo_team_ratings_matches_processed_check;
alter table public.elo_team_ratings add constraint elo_team_ratings_matches_processed_check check(matches_processed >= 0);
alter table public.elo_league_ratings drop constraint if exists elo_league_ratings_evidence_matches_check;
alter table public.elo_league_ratings add constraint elo_league_ratings_evidence_matches_check check(evidence_matches >= 0);
alter table public.elo_cross_fixtures drop constraint if exists elo_cross_fixtures_goals_check;
alter table public.elo_cross_fixtures add constraint elo_cross_fixtures_goals_check check(home_goals >= 0 and away_goals >= 0);
alter table public.elo_fixture_history drop constraint if exists elo_fixture_history_goals_check;
alter table public.elo_fixture_history add constraint elo_fixture_history_goals_check check(home_goals >= 0 and away_goals >= 0);
