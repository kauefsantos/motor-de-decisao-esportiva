# Stage 7B — robust calibration for domestic 1X2 + Elo

Date: 2026-09-14

## Scope

Stage 7B keeps the exact challenger `goals-baseline-v2-recency+elo-v1-w020` frozen and changes only the probability calibration layer. It exists because Stage 7 temperature scaling improved the fit window but failed the untouched retrospective gate.

Stage 7B does **not** change the predictive model, feature set, Elo logic, business thresholds, bankroll policy, or production authorization rules.

## Candidate

- Market family: `1X2`
- Model: `goals-baseline-v2-recency+elo-v1-w020`
- Calibration version: `isotonic-classwise-v1-fit-through-2026-05-31`
- Method: class-wise isotonic calibration over equal-frequency pre-bins, blended back toward the raw probability and renormalized across HOME/DRAW/AWAY.

## Leakage-safe selection protocol

The pre-holdout history is split again so hyperparameters are not selected using the retrospective shadow window:

1. Internal fitting: dates before 2026-04-01.
2. Internal selection: 2026-04-01 through 2026-05-31.
3. Refit: selected bin-count/blend is refit using the full calibration window through 2026-05-31.
4. Untouched retrospective shadow: 2026-06-01 through 2026-09-13.
5. Untouched prospective holdout: predictions persisted from 2026-09-14 onward, before the corresponding fixture.

Candidate grid is limited in advance to bin counts 15/25/40/60 and shrinkage blends 0.25/0.50/0.75/1.00. The internal selector first requires no Brier or LogLoss degradation and an improved max calibration gap relative to raw probabilities. Among eligible candidates it prioritizes the smallest max calibration gap, then LogLoss and Brier.

The retrospective window is never used to choose bin count or blend.

## Retrospective acceptance

`SHADOW_READY` requires every condition below:

- sufficient internal fit sample;
- sufficient internal selection sample;
- sufficient untouched retrospective sample;
- the selected internal candidate passed its internal no-degradation gate;
- calibrated Brier remains better than the empirical baseline;
- calibrated LogLoss remains better than the empirical baseline;
- calibrated Brier does not degrade the raw challenger;
- calibrated LogLoss does not degrade the raw challenger;
- max calibration gap <= 0.10;
- stability coverage includes at least three qualifying leagues and three qualifying time periods.

Failure of any item produces `CALIBRATION_REJECTED`.

## Prospective holdout

A `SHADOW_READY` artifact may be persisted into future 1X2 predictions as `p_cal` plus its exact `calibration_version`. Model status remains experimental and `conservative_probability` remains null.

The final holdout requires at least 200 completed future fixtures and at least three qualifying leagues. It must not degrade raw Brier/LogLoss and must keep max calibration gap <= 0.10.

`HOLDOUT_PASSED` is still **not** `PRODUCTION_VALIDATED`. Promotion requires a separate governed change after review of the exact frozen artifact.

## Money gates remain unchanged

- model probability >= 70%
- execution odd >= 1.70
- EV >= 8%
- edge >= 5 percentage points
- maximum three selections
- zero selections is valid
- positive stake remains impossible without a separately `PRODUCTION_VALIDATED` artifact and the existing production prerequisites.
