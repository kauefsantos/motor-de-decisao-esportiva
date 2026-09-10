# Migration baseline and recovery runbook

## Why this exists

The live database contains schema changes that are newer than the rows currently recorded in `supabase_migrations.schema_migrations`. The live schema is therefore the operational source of truth for the current environment, while the migration-history table is incomplete metadata.

This runbook deliberately avoids two unsafe shortcuts:

1. **Do not fabricate rows in `supabase_migrations.schema_migrations`.** A row in that table must never be used merely to make history look clean.
2. **Do not replay old migrations blindly against production.** Several migrations are already materially present in the live schema even though the migration-history table does not record them.

## Current baseline procedure

Before any recovery or new-environment build:

1. Take a schema-only snapshot of the live database and retain it as an immutable recovery artifact outside the application runtime.
2. Record the list, checksum and ordering of repository migrations.
3. Compare the live schema to the expected objects from each migration in a disposable database. Classify each migration as `materialized`, `partially materialized`, or `not materialized` based on the objects and behavior it creates—not based only on the migration-history table.
4. Treat the most recent fully verified live state as the baseline. New migrations after that baseline must be forward-only and idempotent where practical.
5. Run the validation checklist below before promoting a reconstructed environment.

## Reconstructing a disposable environment

Preferred recovery workflow:

- restore the verified schema/data backup into a disposable Supabase/PostgreSQL environment;
- apply only migrations that are demonstrably newer than the recorded baseline;
- run application tests and database invariants;
- compare critical object definitions (`pg_get_functiondef`, constraints, triggers, grants, RLS and cron jobs) with the live reference;
- only after equivalence is established should the procedure be promoted to a production recovery plan.

If a clean-from-zero rebuild is required, first build and validate a **formal baseline migration/snapshot** in a disposable environment. Do not infer that applying every historical file in lexical order to an empty database is safe until that path has passed the full validation suite.

## Required validation after recovery

Validate at minimum:

- every application table in `public` has RLS enabled;
- there are no permissive browser policies unless explicitly designed and reviewed;
- `anon` and `authenticated` have no direct application-table grants in the current service-only architecture;
- no privileged `SECURITY DEFINER` function is executable by browser roles;
- the single-user Google authorization trigger exists and rejects unauthorized identities;
- Elo target/cross-target counts and the Elo integrity audit match the expected baseline;
- pg_cron jobs 8/9 (or their intentionally migrated replacements) are active and point to the expected database functions;
- bankroll constraints and state-transition guards are installed;
- `experimental_bankroll_config.min_stake_brl = 0.50`;
- the global 5Dollar rate-limit coordinator exists and is service-role only;
- CI tests, typecheck, lint, static security checks and build are green.

## How to reconcile migration metadata later

Use only an official, reviewed Supabase migration-repair/baseline workflow after validating the exact live-vs-repository state in a disposable environment. Capture a backup first and preserve the evidence used to classify each historical migration. Until that reconciliation is performed, the incomplete migration-history table is a known operational debt, not something to be hidden by manual inserts.

## New migration policy

From this hardening round onward:

- migrations are committed before/with live DDL;
- a migration must be safe to inspect independently of application code;
- security-sensitive migrations include verification queries or documented invariants;
- application code depending on a new RPC/constraint is merged only after the live database object has been validated;
- schema history is never edited solely to silence drift warnings.
