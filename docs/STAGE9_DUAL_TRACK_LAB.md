# Stage 9 dual-track operation

## Product goal

The application has two deliberately separate rails:

1. **Entertainment / experimental rail** — the owner can continue running analyses with the current uncertainty-linear 40% domestic 1X2 model, inspect odds, probability, EV and edge, and record simulated/experimental decisions. This rail is not blocked by statistical certification.
2. **Stage 9 laboratory rail** — calibration and prospective validation run independently in the background. This rail may test calibration alternatives, place a candidate in shadow, collect the untouched holdout and eventually certify the model only if every canonical gate passes.

The distinction is intentional: `implemented/tested/working` is not the same as `PRODUCTION_VALIDATED`.

## Experimental rail

Current domestic 1X2 runtime:

`goals-baseline-v2-recency+elo-v1-w020+1x2-uncertainty-linear-v1-w040`

The experimental decision flow remains available even while the model registry is `NOT_PRODUCTION_VALIDATED`. Production-only opportunity evaluation remains fail-closed and is not weakened by this feature.

Canonical selection rules remain unchanged:

- model probability >= 70%
- entry odd >= 1.70
- EV >= 8%
- edge >= 5 percentage points
- maximum 3 selections
- zero selections is valid

Real-money stake authorization remains separate and blocked while the relevant model is not production validated.

## Stage 9 laboratory rail

Stage 9 continues to use the frozen uncertainty-linear 40% direction formula. Calibration is a separate layer.

The daily laboratory orchestrator runs at 06:15 America/Sao_Paulo, with a 06:20 delivery-recovery slot. It is idempotent by local date.

Behavior:

- if no Stage 9 artifact exists, run the calibration search;
- if the calibration is `SHADOW_READY`, refresh the prospective holdout;
- if the fixed calibration experiment was rejected, do not waste compute repeating the exact same experiment every day; record a daily status event instead;
- if the holdout has passed, re-check the governed promotion path;
- if the model is already `PRODUCTION_VALIDATED`, no further promotion work is dispatched.

The prospective holdout still requires at least 200 untouched settled fixtures beginning on 2026-09-14. The <=10 percentage-point max calibration gap, Brier/LogLoss preservation, temporal/league stability and no-leakage requirements remain unchanged.

## Notification bridge

Lovable Cloud is the bridge between the laboratory and the UI. No additional Edge Function is required.

`private.model_lab_events` stores owner-scoped events such as:

- calibration started;
- calibration result / selected candidate;
- shadow readiness;
- prospective holdout progress;
- laboratory error;
- final production validation.

The browser never reads private validation tables directly. Authenticated server functions read only the current owner's events through service-only RPCs. Events are deduplicated and the UI polls the compact feed once per minute.

The home screen shows a Stage 9 laboratory box with the latest event and recent history. Opportunity review explicitly labels the current user-facing rail as **Modo diversão · experimental ativo** and explains that Stage 9 runs in parallel.

## Governance boundary

This dual-track feature MUST NOT:

- set `PRODUCTION_VALIDATED` by itself;
- relax calibration/scoring/holdout thresholds;
- replace the experimental runtime from a retrospective result alone;
- unlock real stake;
- treat entertainment-mode usage as prospective validation evidence unless the existing untouched-holdout rules independently accept the prediction.

Only the existing governed Stage 9 promotion path may certify the model after the holdout passes every required gate.
