<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project maintenance rules

- Do not create or remix another Lovable project for this repository.
- Keep `Lovable Cloud` as the runtime/database source of truth and GitHub `main` as the versioned-code source of truth.
- Do not edit `supabase_migrations.schema_migrations` manually.
- Do not reintroduce generic shadcn/UI scaffolding. Add a UI primitive only when an application file actually uses it.
- Prefer application-specific components over broad generated component sets.
- Do not revive legacy experimental flows when the current flow already supersedes them.
- Preserve the separation between probability generation and bookmaker-price/value evaluation.
- Any new quantitative behavior needs tests and point-in-time/OOS evidence where applicable.
- Keep canonical documentation current after architectural, operational, metric, source, schema or access-control changes.
- Follow `docs/GOVERNANCE.md` for domain ownership and change rules.
- Metric semantics are versioned in `docs/METRICS_GLOSSARY.md` and `public.metric_definitions`; never silently redefine an existing version.
- New data lineage must use a registered `source + definition_version` from the governed source catalog.
- Preserve legacy decision-policy rows, but do not mix them silently with `decision-v2-strict70` analytics.
- Schema/RLS changes require migration plus database regression tests; these tests are part of required `test-and-build`.
- Access reviews are quarterly; unavailable external evidence remains explicitly `REVIEW_REQUIRED`.
