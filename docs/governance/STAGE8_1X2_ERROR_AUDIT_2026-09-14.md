# Stage 8 — 1X2 deep error audit

Date: 2026-09-14

## Scope

Stage 8 begins with an audit-only replay of the frozen benchmark `goals-baseline-v2-recency+elo-v1-w020`. The purpose is to identify where the retrospective 1X2 calibration error originates before any challenger formula is designed.

This stage does **not** alter the benchmark formula, calibration algorithm, betting gates, model status, prospective holdout, or bankroll authorization.

## Frozen retrospective window

- start inclusive: `2026-06-01`
- end exclusive: `2026-09-14`
- same canonical Stage 6 history loader and point-in-time walk-forward rules
- same-day fixtures remain excluded from training
- Elo snapshots must be the fixture `before` values for `elo-v1-w020`
- odds remain excluded as model features
- cross-league competitions remain excluded from the domestic benchmark

## Required audit dimensions

The report segments errors by:

- HOME / DRAW / AWAY class calibration;
- favorite side and favorite probability band;
- league and month;
- Elo level and home-away Elo difference;
- total goals lambda and home-away lambda difference;
- league home-goal edge;
- goals sample size and training sample size;
- share of training observations from the previous 120 days;
- home/away attack and defense factors.

For every slice the audit records sample size, Brier, LogLoss, ECE, max calibration gap, average signed probability error, worst calibration bucket and Elo-vs-no-Elo deltas.

## Calibration-gap interpretation

The official validation rule remains unchanged:

`max calibration gap <= 0.10`

Stage 8 additionally reports a **diagnostic-only structural max gap** restricted to calibration buckets with at least 30 observations. This is used only to distinguish a tiny-tail failure from a repeated structural error. It cannot make a failed official gate pass and cannot be used for promotion.

## Elo counterfactual

For each walk-forward prediction, the audit retains the same pre-Elo goals forecast and compares it with the existing Elo-adjusted forecast on the identical fixture set. This isolates whether the current Elo tilt improves or worsens Brier/LogLoss in specific segments without fitting a new model.

## Evidence persistence

Stage 8 reports are stored in `private.model_error_audit_artifacts` and linked to their validation job. The completion path intentionally does not update `public.model_versions.out_of_sample_metrics`, preserving Stage 6/7/7B/7C evidence.

## Promotion and bankroll guardrails

- benchmark remains frozen;
- no automatic challenger promotion;
- no automatic calibration activation;
- no `SHADOW_READY` is granted by the audit;
- the 200-match prospective holdout does not start from this audit alone;
- `HOLDOUT_PASSED` is not equivalent to `PRODUCTION_VALIDATED`;
- real stake remains blocked unless an explicit later promotion establishes `PRODUCTION_VALIDATED`;
- betting gates remain unchanged: probability >= 70%, execution odd >= 1.70, EV >= 8%, edge >= 5 percentage points, maximum 3 final selections; zero selections remains valid.

## Next decision

Only after the completed audit identifies empirically stable error drivers may Stage 8 propose one or more versioned challengers. Challenger features must be justified by the audit, use separated temporal selection/evaluation windows, preserve point-in-time causality, and be compared with the frozen benchmark and baseline before any recalibration is attempted.
