-- PostgreSQL cannot CREATE OR REPLACE a function when OUT parameters change.
-- Drop the previous claim signature immediately before the resilience migration
-- recreates it with the lease_token OUT column.
drop function if exists public.claim_analysis_job(uuid,uuid);
