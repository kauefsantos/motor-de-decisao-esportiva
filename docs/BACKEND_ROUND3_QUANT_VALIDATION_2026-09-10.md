# Backend Round 3 — Quantitative validation — 2026-09-10

## Scope

This document records the evidence used to choose the count distribution for the experimental corners/cards markets. The objective was not to replace Poisson everywhere, but to test whether NB2 overdispersion improves strictly chronological out-of-sample probability quality for each contract family.

The conditional lambdas remain those produced by the existing attack/defence + shrinkage model. The benchmark changes only the count distribution around the same lambda.

## Validation design

- Expanding chronological walk-forward.
- Three non-overlapping test windows.
- Dispersion estimated from training data only.
- Primary probability metrics: Brier score and log loss.
- A distribution is promoted only when both metrics improve consistently out of sample.
- Production inference requires at least 30 historical training matches before applying an estimated dispersion. Below that threshold, the runtime falls back to Poisson.

## Results

| Contract | OOS predictions | NB2 Brier improvement | NB2 log-loss improvement | Runtime policy |
| --- | ---: | ---: | ---: | --- |
| Match corners O/U 9.5 | 898 | +1.17% | +1.13% | Negative Binomial when training >= 30 and alpha > 0 |
| Team corners O/U 4.5 | 1,796 | +1.65% | +1.86% | Negative Binomial when training >= 30 and alpha > 0 |
| Match card-points O/U 4.5 | 251 | +3.06% | +2.57% | Negative Binomial when training >= 30 and alpha > 0 |
| Team card-points O/U 4.5 | 502 | -1.17% | -1.31% | Poisson |

The team-card result is important: match-level card overdispersion must not be generalized to team-card contracts. The backend therefore uses a hybrid policy rather than one distribution for all count markets.

## Runtime contract

`count-contract-distribution-v1` applies the following rules:

- `corners_match_total`: NB2 if the sample/alpha gates pass; otherwise Poisson.
- `corners_team_total`: NB2 if the sample/alpha gates pass; otherwise Poisson.
- `cards_match_total`: NB2 if the sample/alpha gates pass; otherwise Poisson.
- `cards_team_total`: always Poisson until a future walk-forward benchmark demonstrates otherwise.

Every generated count prediction persists enough information in `outcome_distribution` to reproduce the probabilities:

- lambda;
- selected distribution;
- applied alpha;
- fitted/estimated alpha;
- dispersion training sample;
- policy version;
- reason for using NB2 or falling back to Poisson.

Reference lines are rebuilt from that persisted distribution, so an NB2 anchor cannot silently produce Poisson probabilities for alternate lines.

## Card settlement limitation

The card model remains a Bet365 points proxy: yellow = 1 and red = 2. The aggregate 5Dollar data does not expose enough identity detail to guarantee removal of second-yellow dismissals or non-player cards exactly as Bet365 settlement does. This remains an explicit external-data limitation, not a solved equivalence.

## Goals

Goals were deliberately not migrated to Negative Binomial in this round. A separate score-model benchmark (for example Dixon-Coles/bivariate Poisson) is required before changing the goals distribution.
