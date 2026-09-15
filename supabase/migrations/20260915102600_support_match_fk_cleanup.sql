-- Support parent-match cleanup and FK enforcement without full-table scans.
-- raw_observations can become large; the single-column FK on match_id needs
-- a supporting index even though other run-oriented indexes already exist.
create index if not exists idx_raw_observations_match_id
  on public.raw_observations(match_id);
