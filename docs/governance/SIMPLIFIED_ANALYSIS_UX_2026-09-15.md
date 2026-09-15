# Simplified Analysis UX — 2026-09-15

## Evidence that triggered the redesign

The scheduled analysis for target date 2026-09-17 completed successfully with 16/16 matches resolved and zero failed matches. The decision queue evaluation completed with zero qualified opportunities and the selection was finalized with zero selections. This is a valid business outcome, not a processing failure.

The previous interface made that valid zero-result state difficult to understand because action content, model diagnostics, source audit, advanced metrics, Stage 9 context, navigation and secondary account information competed in the same visual layer.

## UX principle

The redesign follows one rule: **what requires a user decision stays visible; technical explanation and diagnostics stay available through progressive disclosure.**

Primary visible content is now limited to the current task, its state, the minimum information required to decide, and one clear next action. Technical details remain accessible in `details`/collapsible areas and are not deleted.

## Main changes

- Home is organized around one next action and a clear new-analysis entry point.
- Analysis progress uses plain-language stages and one progress indicator instead of a dense step dashboard.
- Odds confirmation surfaces only missing manual odds; automatically resolved quotes are moved to details.
- Opportunity cards show match, market, current odd and calculated chance first; EV/edge remain available under details.
- A zero-opportunity result is presented as a successful completed analysis with explicit explanation that the engine does not force picks.
- Final review prioritizes match, market, odd and registration; advanced analytical metrics are collapsed.
- Source and collection diagnostics are grouped under `Detalhes técnicos`.
- Model-lab notifications, history, bankroll, help and secondary actions are no longer allowed to dominate the primary workflow.
- User-facing terminology was shortened and translated into task language such as `Enviar jogos`, `Analisar`, `Escolher`, `Registrar`, `Conferir jogos`, `Avaliar oportunidades` and `Descartar`.

## Rules explicitly preserved

This UX change does **not** change statistical or business behavior. In particular it does not modify:

- the active fun-mode model or its formula;
- Elo, Davidson, uncertainty-linear weights or goal lambdas;
- Stage 9 gates, holdout rules or promotion path;
- probability, odd, EV or edge thresholds;
- the maximum of 3 selections, one main selection per match and same-family limits;
- the rule that zero final selections is valid;
- the separation between experimental/fun usage and production validation;
- bankroll/stake rules;
- D+2 automation, fixture identity, worker processing or push delivery;
- decision persistence, quote refresh or idempotency behavior.

## Validation expectation

Merge is allowed only after the repository's existing mandatory CI gates pass, including static quality, database regressions, functional decision-flow E2E, experimental engine E2E, unit tests, build, performance/load checks, and the Chromium/Firefox/WebKit responsive-accessibility matrix.
