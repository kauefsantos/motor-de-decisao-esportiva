-- Stage 3 follow-up — provider fixture id is the canonical match identity.
--
-- Production observations can legitimately carry an older textual league alias
-- for the same FiveDollar fixture (for example brazil-serie vs brazil-serie-a).
-- Treating that alias drift as a data conflict would discard valid history.
-- Keep fixture/date/team/outcome disagreements fail-closed, but let the most
-- recent/preferred textual lineage label replace the older alias.

create or replace function private.merge_five_dollar_model_match(
  p_fixture_id bigint,
  p_external_match_id text,
  p_fixture_date date,
  p_home_team_id bigint,
  p_away_team_id bigint,
  p_home_goals numeric,
  p_away_goals numeric,
  p_home_corners numeric,
  p_away_corners numeric,
  p_home_yellow numeric,
  p_away_yellow numeric,
  p_home_red numeric,
  p_away_red numeric,
  p_first_observed_at timestamptz,
  p_last_observed_at timestamptz,
  p_has_conflict boolean default false
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_fixture_id is null or p_fixture_id<=0
    or p_external_match_id is null or pg_catalog.btrim(p_external_match_id)=''
    or p_fixture_date is null
    or p_home_team_id is null or p_home_team_id<=0
    or p_away_team_id is null or p_away_team_id<=0
    or p_first_observed_at is null or p_last_observed_at is null then
    return;
  end if;

  insert into private.five_dollar_model_matches(
    fixture_id,external_match_id,fixture_date,home_team_id,away_team_id,
    home_goals,away_goals,home_corners,away_corners,
    home_yellow,away_yellow,home_red,away_red,
    first_observed_at,last_observed_at,has_conflict,updated_at
  ) values(
    p_fixture_id,p_external_match_id,p_fixture_date,p_home_team_id,p_away_team_id,
    p_home_goals,p_away_goals,p_home_corners,p_away_corners,
    p_home_yellow,p_away_yellow,p_home_red,p_away_red,
    p_first_observed_at,p_last_observed_at,coalesce(p_has_conflict,false),pg_catalog.now()
  )
  on conflict(fixture_id) do update
  set
    -- fixture_id is the provider identity. A text alias by itself is lineage
    -- drift, not evidence that two real matches were mixed.
    external_match_id=excluded.external_match_id,
    has_conflict = private.five_dollar_model_matches.has_conflict
      or excluded.has_conflict
      or private.five_dollar_model_matches.fixture_date<>excluded.fixture_date
      or private.five_dollar_model_matches.home_team_id<>excluded.home_team_id
      or private.five_dollar_model_matches.away_team_id<>excluded.away_team_id
      or (
        private.five_dollar_model_matches.home_goals is not null and excluded.home_goals is not null
        and private.five_dollar_model_matches.home_goals<>excluded.home_goals
      )
      or (
        private.five_dollar_model_matches.away_goals is not null and excluded.away_goals is not null
        and private.five_dollar_model_matches.away_goals<>excluded.away_goals
      )
      or (
        private.five_dollar_model_matches.home_corners is not null and excluded.home_corners is not null
        and private.five_dollar_model_matches.home_corners<>excluded.home_corners
      )
      or (
        private.five_dollar_model_matches.away_corners is not null and excluded.away_corners is not null
        and private.five_dollar_model_matches.away_corners<>excluded.away_corners
      )
      or (
        private.five_dollar_model_matches.home_yellow is not null and excluded.home_yellow is not null
        and private.five_dollar_model_matches.home_yellow<>excluded.home_yellow
      )
      or (
        private.five_dollar_model_matches.away_yellow is not null and excluded.away_yellow is not null
        and private.five_dollar_model_matches.away_yellow<>excluded.away_yellow
      )
      or (
        private.five_dollar_model_matches.home_red is not null and excluded.home_red is not null
        and private.five_dollar_model_matches.home_red<>excluded.home_red
      )
      or (
        private.five_dollar_model_matches.away_red is not null and excluded.away_red is not null
        and private.five_dollar_model_matches.away_red<>excluded.away_red
      ),
    home_goals=coalesce(excluded.home_goals,private.five_dollar_model_matches.home_goals),
    away_goals=coalesce(excluded.away_goals,private.five_dollar_model_matches.away_goals),
    home_corners=coalesce(excluded.home_corners,private.five_dollar_model_matches.home_corners),
    away_corners=coalesce(excluded.away_corners,private.five_dollar_model_matches.away_corners),
    home_yellow=coalesce(excluded.home_yellow,private.five_dollar_model_matches.home_yellow),
    away_yellow=coalesce(excluded.away_yellow,private.five_dollar_model_matches.away_yellow),
    home_red=coalesce(excluded.home_red,private.five_dollar_model_matches.home_red),
    away_red=coalesce(excluded.away_red,private.five_dollar_model_matches.away_red),
    first_observed_at=least(private.five_dollar_model_matches.first_observed_at,excluded.first_observed_at),
    last_observed_at=greatest(private.five_dollar_model_matches.last_observed_at,excluded.last_observed_at),
    updated_at=pg_catalog.now();
end;
$$;

revoke all on function private.merge_five_dollar_model_match(bigint,text,date,bigint,bigint,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function private.merge_five_dollar_model_match(bigint,text,date,bigint,bigint,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,timestamptz,timestamptz,boolean) to service_role;

create or replace function public.backfill_five_dollar_model_history_window(
  p_start timestamptz,
  p_end timestamptz
)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row record;
  v_count bigint:=0;
begin
  if p_start is null or p_end is null or p_end<=p_start then
    raise exception 'Janela histórica inválida.';
  end if;
  if p_end-p_start>interval '62 days' then
    raise exception 'Backfill histórico limitado a 62 dias por execução.';
  end if;

  for v_row in
    select
      (r.raw_value->>'fixtureId')::bigint as fixture_id,
      -- Prefer lineage already attached to a resolved app match because earlier
      -- migrations normalize known competition aliases there. Fall back to any
      -- provider label only when no resolved observation exists.
      coalesce(
        max(r.raw_value->>'externalMatchId') filter(where r.match_id is not null),
        max(r.raw_value->>'externalMatchId')
      ) as external_match_id,
      max((r.raw_value->>'fixtureDate')::date) as fixture_date,
      max(case
        when r.raw_value->>'teamSideInFixture'='HOME' then nullif(r.raw_value->>'teamId','')::bigint
        when r.raw_value->>'teamSideInFixture'='AWAY' then nullif(r.raw_value->>'opponentId','')::bigint
        else null
      end) as home_team_id,
      max(case
        when r.raw_value->>'teamSideInFixture'='AWAY' then nullif(r.raw_value->>'teamId','')::bigint
        when r.raw_value->>'teamSideInFixture'='HOME' then nullif(r.raw_value->>'opponentId','')::bigint
        else null
      end) as away_team_id,
      max(nullif(r.raw_value->'rawHomeAway'->>'goalsHome','')::numeric) as home_goals,
      max(nullif(r.raw_value->'rawHomeAway'->>'goalsAway','')::numeric) as away_goals,
      max(nullif(r.raw_value->'rawHomeAway'->>'cornersHome','')::numeric) as home_corners,
      max(nullif(r.raw_value->'rawHomeAway'->>'cornersAway','')::numeric) as away_corners,
      max(nullif(r.raw_value->>'value','')::numeric) filter(where r.raw_value->>'metricLabelRaw'='cards.home.yellow') as home_yellow,
      max(nullif(r.raw_value->>'value','')::numeric) filter(where r.raw_value->>'metricLabelRaw'='cards.away.yellow') as away_yellow,
      max(nullif(r.raw_value->>'value','')::numeric) filter(where r.raw_value->>'metricLabelRaw'='cards.home.red') as home_red,
      max(nullif(r.raw_value->>'value','')::numeric) filter(where r.raw_value->>'metricLabelRaw'='cards.away.red') as away_red,
      min(r.observed_at) as first_observed_at,
      max(r.observed_at) as last_observed_at,
      (
        count(distinct r.raw_value->>'fixtureDate')>1
        or count(distinct case
          when r.raw_value->>'teamSideInFixture'='HOME' then r.raw_value->>'teamId'
          when r.raw_value->>'teamSideInFixture'='AWAY' then r.raw_value->>'opponentId'
          else null end)>1
        or count(distinct case
          when r.raw_value->>'teamSideInFixture'='AWAY' then r.raw_value->>'teamId'
          when r.raw_value->>'teamSideInFixture'='HOME' then r.raw_value->>'opponentId'
          else null end)>1
        or count(distinct r.raw_value->'rawHomeAway'->>'goalsHome') filter(where r.raw_value->'rawHomeAway'->>'goalsHome' is not null)>1
        or count(distinct r.raw_value->'rawHomeAway'->>'goalsAway') filter(where r.raw_value->'rawHomeAway'->>'goalsAway' is not null)>1
        or count(distinct r.raw_value->'rawHomeAway'->>'cornersHome') filter(where r.raw_value->'rawHomeAway'->>'cornersHome' is not null)>1
        or count(distinct r.raw_value->'rawHomeAway'->>'cornersAway') filter(where r.raw_value->'rawHomeAway'->>'cornersAway' is not null)>1
        or count(distinct r.raw_value->>'value') filter(where r.raw_value->>'metricLabelRaw'='cards.home.yellow')>1
        or count(distinct r.raw_value->>'value') filter(where r.raw_value->>'metricLabelRaw'='cards.away.yellow')>1
        or count(distinct r.raw_value->>'value') filter(where r.raw_value->>'metricLabelRaw'='cards.home.red')>1
        or count(distinct r.raw_value->>'value') filter(where r.raw_value->>'metricLabelRaw'='cards.away.red')>1
      ) as has_conflict
    from public.raw_observations r
    where r.source='five_dollar_football'
      and r.observed_at>=p_start
      and r.observed_at<p_end
      and r.metric in (
        'HOME:goals_for','AWAY:goals_for',
        'HOME:cards_yellow_raw','AWAY:cards_yellow_raw',
        'HOME:cards_red_raw','AWAY:cards_red_raw'
      )
      and coalesce(r.raw_value->>'fixtureId','')<>''
    group by (r.raw_value->>'fixtureId')::bigint
  loop
    perform private.merge_five_dollar_model_match(
      v_row.fixture_id,v_row.external_match_id,v_row.fixture_date,
      v_row.home_team_id,v_row.away_team_id,
      v_row.home_goals,v_row.away_goals,v_row.home_corners,v_row.away_corners,
      v_row.home_yellow,v_row.away_yellow,v_row.home_red,v_row.away_red,
      v_row.first_observed_at,v_row.last_observed_at,v_row.has_conflict
    );
    v_count:=v_count+1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.backfill_five_dollar_model_history_window(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.backfill_five_dollar_model_history_window(timestamptz,timestamptz) to service_role;

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260913-stage3-model-history-alias-reconciliation',
  'stage3_model_history_alias_reconciliation',
  'FiveDollar fixture_id is canonical model-history identity; textual externalMatchId league aliases no longer create false conflicts. Resolved-match lineage is preferred during bounded backfill.'
)
on conflict(version) do update
set migration_name=excluded.migration_name,
    notes=excluded.notes,
    applied_at=pg_catalog.now();
