-- Required before hierarchical Elo migrations schedule jobs through cron.schedule().
-- Lovable Cloud already has pg_cron enabled; this makes a fresh local migration
-- chain match the runtime prerequisite without changing production behavior.
create extension if not exists pg_cron;
