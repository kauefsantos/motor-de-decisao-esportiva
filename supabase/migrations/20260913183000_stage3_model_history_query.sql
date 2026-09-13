-- Stage 3 — bounded model-history read for background inference.
--
-- Production replay showed that paging every FiveDollar raw observation from the
-- previous 365 days transfers hundreds of thousands of JSON rows and can exceed
-- the Lovable Cloud statement timeout. The model only needs one latest snapshot
-- per provider fixture/team/metric for goals, corners and the current card proxy.
-- Keep the point-in-time cutoff strict: observed_at must remain < prediction_at.

create index if not exists idx_raw_observations_model_history_latest
on public.raw_observations (
  ((raw_value->>'fixtureId')),
  ((raw_value->>'teamId')),
  ((raw_value->>'metricLabelRaw')),
  observed_at desc,
  id desc
)
where source='five_dollar_football'
  and metric in (
    'HOME:goals_for','AWAY:goals_for',
    'HOME:corners_taken_for','AWAY:corners_taken_for',
    'HOME:cards_yellow_raw','AWAY:cards_yellow_raw',
    'HOME:cards_red_raw','AWAY:cards_red_raw'
  )
  and coalesce(raw_value->>'fixtureId','')<>''
  and coalesce(raw_value->>'teamId','')<>''
  and coalesce(raw_value->>'metricLabelRaw','')<>'';

create or replace function public.get_five_dollar_model_history_rows(
  p_prediction_at timestamptz,
  p_lookback_days integer default 365
)
returns table(raw_value jsonb)
language sql
stable
security definer
set search_path=''
as $$
  with latest_ids as (
    select distinct on (
      r.raw_value->>'fixtureId',
      r.raw_value->>'teamId',
      r.raw_value->>'metricLabelRaw'
    ) r.id
    from public.raw_observations r
    where p_prediction_at is not null
      and p_lookback_days between 1 and 730
      and r.source='five_dollar_football'
      and r.metric in (
        'HOME:goals_for','AWAY:goals_for',
        'HOME:corners_taken_for','AWAY:corners_taken_for',
        'HOME:cards_yellow_raw','AWAY:cards_yellow_raw',
        'HOME:cards_red_raw','AWAY:cards_red_raw'
      )
      and coalesce(r.raw_value->>'fixtureId','')<>''
      and coalesce(r.raw_value->>'teamId','')<>''
      and coalesce(r.raw_value->>'metricLabelRaw','')<>''
      and r.observed_at >= p_prediction_at - pg_catalog.make_interval(days => p_lookback_days)
      and r.observed_at < p_prediction_at
    order by
      r.raw_value->>'fixtureId',
      r.raw_value->>'teamId',
      r.raw_value->>'metricLabelRaw',
      r.observed_at desc,
      r.id desc
  )
  select r.raw_value
  from latest_ids l
  join public.raw_observations r on r.id=l.id
  order by
    r.raw_value->>'fixtureDate',
    r.raw_value->>'fixtureId',
    r.raw_value->>'teamId',
    r.raw_value->>'metricLabelRaw'
$$;

revoke all on function public.get_five_dollar_model_history_rows(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.get_five_dollar_model_history_rows(timestamptz,integer) to service_role;

comment on function public.get_five_dollar_model_history_rows(timestamptz,integer) is
  'Returns deduplicated FiveDollar model-history rows strictly before prediction_at. Restricts transfer to goals, corners and current card-proxy inputs and keeps only the latest observation per fixture/team/raw metric.';

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260913-stage3-model-history-query',
  'stage3_model_history_query',
  'Replaces 365-day raw JSON pagination in model inference with a server-only, point-in-time-safe, deduplicated history RPC backed by a targeted partial index.'
)
on conflict(version) do update
set migration_name=excluded.migration_name,
    notes=excluded.notes,
    applied_at=pg_catalog.now();
