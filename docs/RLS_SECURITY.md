# RLS / Database Security Contract

## Sources of truth

- **Runtime/environment:** Lovable Cloud is the source of truth for the database and the application environment actually in use.
- **Versioned code:** GitHub `main` is the source of truth for migrations, tests and application code.
- A database hardening applied in Lovable Cloud must have an equivalent migration committed to GitHub so the runtime and versioned history remain reproducible.

## Current access model

The application is intentionally **private and single-user**.

- Browser roles (`anon` and `authenticated`) must not have direct privileges on application relations in `public`.
- All public application tables must have Row Level Security enabled.
- Privileged database operations are performed only from trusted server code using `service_role`.
- `service_role` bypasses RLS by design and must never be exposed to browser/client bundles.
- Application `SECURITY DEFINER` functions must use an empty `search_path` and explicitly schema-qualify application objects.
- Browser roles must not be able to execute privileged `SECURITY DEFINER` functions.

## Multi-user guardrail

Do **not** add a second allowed application user by merely expanding the authentication allowlist.

Before any multi-user rollout, redesign ownership and authorization at the data layer. At minimum, central user-owned records must gain an explicit ownership key (`owner_id`/`user_id` or an equivalent tenant key), RLS policies must scope reads and writes to that ownership, server operations must enforce the same authorization boundary, and migration/tests must cover cross-user isolation.

Until that redesign exists, the single-user restriction is part of the security boundary.

## Regression protection

`supabase/tests/rls_security.test.sql` verifies that:

1. every public table has RLS enabled;
2. browser roles have no direct privileges on public tables/views;
3. browser roles cannot execute `SECURITY DEFINER` functions;
4. application `SECURITY DEFINER` functions use an empty `search_path`;
5. `service_role` retains execution permission on public privileged functions.

`.github/workflows/database-security.yml` applies the migration chain to a local Supabase database and runs these database tests for relevant pushes and pull requests.
