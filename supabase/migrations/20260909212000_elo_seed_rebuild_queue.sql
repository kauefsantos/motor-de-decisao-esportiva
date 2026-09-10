-- Reproduce the Elo seed rebuild queue that exists in Lovable Cloud before the
-- security hardening migration locks it down. This table was previously created
-- in the runtime without a corresponding versioned migration.
create table if not exists public.elo_seed_rebuild_queue (
  league_id bigint primary key,
  pass1_done boolean not null default false,
  pass2_done boolean not null default false,
  updated_at timestamptz not null default now()
);
