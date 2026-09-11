-- Complete the ownership boundary by forcing RLS on the root and the indirect
-- match ownership table as well. service_role keeps BYPASSRLS intentionally;
-- application code must therefore retain its explicit ownership guards.
alter table public.analysis_runs force row level security;
alter table public.match_external_ids force row level security;
