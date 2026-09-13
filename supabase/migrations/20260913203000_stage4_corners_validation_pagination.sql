-- Stage 4 follow-up: the runtime API caps RPC responses near 1,000 rows.
-- Expose deterministic keyset pages so the validator consumes the full
-- canonical history instead of silently validating only the oldest slice.

create or replace function public.get_stage4_corners_validation_rows_page(
  p_after_date date default null,
  p_after_fixture_id bigint default null,
  p_limit integer default 750
)
returns table(
  fixture_id bigint,
  fixture_date date,
  league text,
  home_team_id bigint,
  away_team_id bigint,
  home_corners numeric,
  away_corners numeric
)
language sql
stable
security definer
set search_path=''
as $$
  select
    m.fixture_id,
    m.fixture_date,
    pg_catalog.split_part(m.external_match_id, ':', 1) as league,
    m.home_team_id,
    m.away_team_id,
    m.home_corners,
    m.away_corners
  from private.five_dollar_model_matches m
  where m.has_conflict=false
    and m.fixture_date is not null
    and m.fixture_date < (pg_catalog.now() at time zone 'America/Sao_Paulo')::date
    and m.external_match_id is not null
    and m.home_team_id is not null
    and m.away_team_id is not null
    and m.home_corners is not null
    and m.away_corners is not null
    and (
      p_after_date is null
      or m.fixture_date > p_after_date
      or (
        m.fixture_date = p_after_date
        and m.fixture_id > coalesce(p_after_fixture_id, 0::bigint)
      )
    )
  order by m.fixture_date,m.fixture_id
  limit least(greatest(coalesce(p_limit,750),1),750);
$$;

revoke all on function public.get_stage4_corners_validation_rows_page(date,bigint,integer) from public,anon,authenticated;
grant execute on function public.get_stage4_corners_validation_rows_page(date,bigint,integer) to service_role;

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260913-stage4-corners-validation-pagination',
  'stage4_corners_validation_pagination',
  'Adds bounded keyset pagination for the canonical Stage 4 corners validation dataset after production evidence showed the runtime RPC response cap truncated the first run.'
)
on conflict (version) do update
set migration_name=excluded.migration_name,
    notes=excluded.notes,
    applied_at=pg_catalog.now();
