-- Close the remaining race window for concurrent retries of the same raw observation.
create or replace function public.ignore_duplicate_raw_observation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.observation_key := public.raw_observation_identity(
    new.run_id,
    new.match_id,
    new.source,
    new.metric,
    new.raw_value,
    new.observed_at,
    new.definition_version
  );

  perform pg_advisory_xact_lock(
    hashtextextended(new.run_id::text || ':' || new.observation_key, 0)
  );

  if exists (
    select 1
    from public.raw_observations r
    where r.run_id = new.run_id
      and r.observation_key = new.observation_key
  ) then
    return null;
  end if;

  return new;
end;
$$;
