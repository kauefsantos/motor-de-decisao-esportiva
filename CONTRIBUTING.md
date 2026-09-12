# Contributing

This repository is maintained as a portfolio-quality product case. Changes should preserve traceability between business rules, code, tests, Lovable Cloud migrations and production behavior.

## Development workflow

1. Create a focused branch from the latest `main`.
2. Keep each pull request limited to one coherent problem or improvement.
3. Add or update regression tests for behavior changes.
4. When governed code or a Lovable Cloud migration changes, update the corresponding documentation.
5. Do not merge while any required CI check is failing or still pending.
6. Prefer squash merge so `main` stays readable.
7. After merge, distinguish clearly between code merged, Lovable Cloud migration applied, deployment published and production behavior validated.

## Required local checks

```bash
bun install
bun run check
bunx vitest run
bun run build
```

Database migrations and SQL regressions are also executed by CI.

## Architecture rules

- Quantitative/domain logic belongs in pure engine/domain modules.
- Routes must not access the privileged Lovable Cloud client directly.
- External providers should be isolated behind adapters.
- Critical persistence operations should use typed repositories/RPC contracts rather than ad-hoc client calls.
- Secrets are server-side only.
- Business-rule thresholds must have boundary tests.
- Do not fabricate probabilities, odds, fixtures or validation evidence.

## Quantitative changes

Changes to probability models, market settlement, calibration, edge/EV rules, portfolio selection or staking require evidence appropriate to the change. A model being implemented does not mean it is production-validated. Production claims should be backed by out-of-sample or walk-forward evaluation and explicit model/version metadata.

## Lovable Cloud changes

All structural database changes must be represented by a versioned migration and a regression test when feasible. Production data should not be modified merely to prove a test; prefer transactions with rollback or read-only inspection.

## Pull request quality bar

A strong pull request explains:

- the problem and evidence;
- scope and non-goals;
- implementation;
- tests executed;
- migration/deployment requirements;
- what has and has not been validated in production.

This distinction is mandatory: **implemented ≠ tested ≠ merged ≠ published ≠ validated in production**.