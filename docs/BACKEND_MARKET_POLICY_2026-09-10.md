# Backend Market Policy Audit — 2026-09-10

## Scope

This document covers the experimental football-market backend only: which markets are generated, which lines are offered for bookmaker quotation, how value is decided, how alternative lines are treated, and the statistical limitations of the current models.

Lovable Cloud remains the source of truth for the live data/runtime. GitHub `main` remains the versioned source of truth after this branch is validated and merged.

## Problem confirmed in the live run

The latest inspected run for 2026-09-11 contained 17 matches and 1,545 experimental `model_predictions`, of which 408 were at or above the previous 75% probability gate. The largest contributors were repeated total lines for match and team corners/cards/goals.

The old design mixed two distinct concepts:

1. lines that the user/bookmaker should actually quote; and
2. lines that are useful only as model references.

That made the UI ask for too many prices and biased the visible set toward extreme, high-probability lines.

## Refined business rule

### Core principle: quote anchor vs reference ladder

A **quote anchor** is a deliberately small set of normal bookmaker lines for which a real Bet365 price can be entered or fetched.

A **reference ladder** is a bounded set of nearby lines used only after the model has indicated a direction. Reference lines can have model probability, fair odd and a minimum target odd, but they are **not value bets until a real bookmaker odd for that exact line exists**.

No alternative bookmaker price is extrapolated or invented from an anchor price.

### Real half-lines

Experimental totals use the real bookmaker half-line as `line_canonical`. This removes the previous asymmetric mapping where an integer limit became one line for OVER and a different line for UNDER.

Examples:

- corners match anchor: 9.5
- team corners anchor: 4.5
- goals match anchor: 2.5
- cards match/team anchor: 4.5

At a half-line, OVER and UNDER are complementary: no integer outcome is missing from both sides.

## Market policy

### Corners — match

Quote anchors:
- Over 9.5
- Under 9.5

Reference ladder:
- Over: 10.5
- Under: 8.5, 7.5, 6.5

### Corners — team

For each team, quote anchors:
- Over 4.5
- Under 4.5

Reference ladder:
- Over: 5.5, 6.5, 7.5
- Under: 3.5, 2.5

### Goals — match

Quote anchors:
- Over 2.5
- Under 2.5

Reference ladder:
- Over: 3.5
- Under: 1.5

Team-goal totals and BTTS are removed from this revised experimental flow. They can be reconsidered later as separate, validated families rather than increasing the quotation surface now.

### Cards — match and team

For the match and for each team, quote anchors:
- Over 4.5
- Under 4.5

Reference ladder:
- Over: 5.5, 6.5
- Under: 3.5, 2.5

### Final result

Exactly three quote candidates:
- home win
- draw
- away win

### Double chance

Exactly three quote candidates:
- 1X
- X2
- 12

### Maximum quote surface

When every model is available, a match can expose at most 20 fields for quotation:

- 6 corners
- 6 cards
- 2 goals
- 3 final-result choices
- 3 double-chance choices

The backend no longer needs to expose every reference-ladder line as a user-facing candidate.

## Value rule

The 75% raw probability gate is not a valid prerequisite for value betting and is removed from the experimental quotation/value path.

Example: a model probability of 60% at decimal odd 2.00 implies expected value of:

`0.60 * 2.00 - 1 = +0.20`, or +20%.

Rejecting it solely because 60% is below 75% would discard a potentially positive-price opportunity.

The production `BASE_GATE` is not changed by this work. The experimental flow instead evaluates a valid experimental probability against the real bookmaker odd.

The existing experimental price threshold remains `EV_TARGET = 2%`.

## Direction assessment

For paired OVER/UNDER anchor markets:

1. real odds are evaluated independently;
2. if one or both have value, the side with the higher EV becomes `VALUE_OVER` or `VALUE_UNDER`;
3. if neither has confirmed value, the model may report a directional lean only when its anchor probability is at least 55%;
4. otherwise the market is `NEUTRAL`.

`MODEL_LEAN_OVER` and `MODEL_LEAN_UNDER` are **not betting recommendations and are not value classifications**. They only tell the user which bounded nearby lines may be worth checking for a real price.

Every returned reference alternative is marked `requiresRealOdd: true` and `valueStatus: NAO_AVALIADO`.

## Current statistical models — audit

### Corners: `corners-baseline-v1`

Implemented today:
- team attack/defence rates by venue;
- shrinkage toward competition means;
- Poisson count distribution;
- deterministic temporal validation utilities with MAE, Brier score, log loss and calibration bins.

Assessment: useful transparent baseline, but not an advanced final model. Football corner counts can be overdispersed relative to Poisson and the model currently has limited context.

### Cards: `cards-total-baseline-v1`

Implemented today:
- reuses the corner attack/defence + shrinkage + Poisson machinery with card counts;
- current raw count is yellow + red cards.

Assessment: baseline only. It does not currently model referee tendency, competition-specific discipline, match context or richer card-definition differences. This is the weakest of the three current market models and should remain experimental.

### Goals: `goals-baseline-v2-recency`

Implemented today:
- attack/defence by venue;
- shrinkage;
- recency weighting;
- independent Poisson goal counts;
- Elo adjustment where the existing hierarchy is applicable.

Assessment: more developed than the card baseline, but independent Poisson does not fully model score dependence, particularly in low-score football outcomes.

## Recommended statistical roadmap

These are recommended next improvements, not claims about the current implementation.

1. **Corners/cards overdispersion:** benchmark Negative Binomial (or equivalent Poisson-Gamma) against Poisson out of sample. Only adopt it if walk-forward scoring improves.
2. **Goals/1X2 dependence:** benchmark Dixon-Coles and/or bivariate Poisson against the current independent-Poisson model.
3. **Recency for corners/cards:** add time-decay and tune its half-life through historical validation instead of selecting it subjectively.
4. **Cards context:** include referee, competition baseline and stable pre-match team-discipline/context features where data definitions are reliable.
5. **Hierarchical shrinkage:** borrow strength explicitly across divisions/leagues without treating different competitions as identical, especially for cross-league matches.
6. **Walk-forward validation:** evaluate every model chronologically and by market family/line, preventing future data leakage.
7. **Probability calibration:** compare raw vs calibrated probabilities out of sample; use isotonic/logistic calibration only with enough held-out data.
8. **Uncertainty-aware value:** move from raw model probability to a conservative calibrated probability before sizing/execution once enough validation data exists.
9. **Closing-line benchmark:** when sufficient historical bookmaker snapshots exist, compare model prices and accepted bets with closing lines as an external efficiency benchmark. Closing prices must never leak into pre-match prediction features.
10. **Portfolio concentration:** later, control correlated final selections from the same match/family instead of ranking EV independently only.

## Additional backend risks found

### Card definition risk

The current card model sums yellow and red raw counts. Bet365 settlement definitions can differ by market/product. Before calling this market production-ready, confirm the exact 5Dollar raw semantics and Bet365 settlement definition and keep them identical end-to-end.

### Calibration / uncertainty

The current experimental value call uses the model probability directly. A statistically stronger system should eventually use an out-of-sample calibrated, conservative probability with an uncertainty margin. This should be introduced only after enough historical validation exists; an arbitrary haircut would create a new unvalidated rule.

### Market-selection dependence

The final selector ranks individually by EV and edge. That is correct for the current experiment but does not account for correlation between picks. A later backend iteration should prevent excessive concentration in one match or strongly correlated markets.

## Acceptance criteria for this refactor

- user-facing quote candidates are bounded to 20 per fully modeled match;
- totals use the same real half-line for OVER and UNDER;
- reference ladder lines never appear as quote candidates;
- experimental value is not pre-blocked by the 75% probability gate;
- no reference line is called value without a real odd;
- weekday final selection remains at most 2 and weekend selection at most 3;
- no bet is forced when none reaches the EV target;
- tests and production build must pass before merge.
