# Home resume UX — 2026-09-12

## Goal

Make every pending item shown on the home page directly actionable without changing betting methodology or authorization boundaries.

## Changes

- Resume actions render as one real button/link pair rather than nested interactive wrappers.
- Pending proposed registrations link directly to the corresponding owner-scoped run result screen.
- The home summary derives the target run only from the authenticated owner's recent run IDs.
- A source-level regression contract protects both behaviors.

## Security and data boundary

The pending-registration target is resolved only from run IDs already filtered by `owner_id` in the authenticated home summary. Existing Lovable Cloud authorization remains authoritative.

## Validation

Merge requires static/type checks, database regressions, functional and experimental E2E, unit tests, build/performance/load checks and the browser/accessibility matrix to pass.
