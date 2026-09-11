# 5DollarFootballAPI Pro Utilization Audit — 2026-09-10

## Scope

This audit compares the current `quant-football-insights` backend with the current 5DollarFootballAPI v1 documentation for the Pro plan. It distinguishes capabilities that are already used, capabilities that can improve the models later, and capabilities that require Ultra.

Official references checked on 2026-09-10:

- https://5dollarfootballapi.com/docs
- https://5dollarfootballapi.com/docs/fixtures
- https://5dollarfootballapi.com/docs/fixture
- https://5dollarfootballapi.com/docs/league-fixtures
- https://5dollarfootballapi.com/docs/odds-history
- https://5dollarfootballapi.com/docs/changelog
- https://help.bet365.com/s/en-ca/card-markets-queries

## Current Pro usage

Already used well:

- native `/v1` API with the key server-side only;
- fixture-day resolution and pagination;
- team and league finished-fixture history;
- goals, full-time corners, yellow cards and red cards from fixture aggregates;
- exact 5Dollar team/league/fixture IDs persisted for reuse;
- batch preflight using `/fixtures?...&include=odds` instead of one odds request for every game;
- Bet365 1X2 prices from the expanded day feed;
- per-fixture Bet365 odds only when a supported total line needs an actual O/U price;
- `goal_line`, `corner_line` and now `card_line` for match totals;
- rate-limit headers, Retry-After handling, server cache and a conservative local 9 requests/minute guard below the documented Pro limit of 10/minute.

## Pro capacity not yet fully used

### Historical opening/closing bookmaker snapshots

The Pro feed exposes opening and current/closing Bet365 snapshots. The current product uses them for present-day price retrieval but does not yet build a historical bookmaker benchmark dataset for walk-forward validation, calibration or closing-line comparison.

Highest-value future use:

- persist pre-match opening/closing prices alongside historical fixtures;
- compare model fair prices with bookmaker base rates;
- calculate closing-line value for accepted bets;
- never use future closing prices as features in a prediction that predates them.

### Compound fixture includes

The API supports compound fixture requests using `include=odds,events,stats`. The current history importer intentionally keeps payloads lean and does not ingest all historical event timelines/statistics.

Potential model features from finished historical matches include:

- timestamped corners and cards;
- first-half/second-half patterns;
- attacks and dangerous attacks;
- shots on/off target;
- possession.

These should be added only through chronological feature engineering with strict prediction-time cutoffs. More fields are not automatically better predictors.

### Corner and card standings

`/v1/standings?type=corner|card` provides competition/team tables that are not used by the current model. They are candidates for league/team priors and cross-checks, especially early in a season when direct samples are small.

They should complement, not replace, fixture-level history and should be walk-forward validated before affecting prices.

### Other Bet365 markets available on Pro

The API documents additional Bet365 markets such as Asian handicap, corner Asian, card Asian, BTTS and half-time markets. They are intentionally not activated merely because data exists: the current business policy only enables a smaller market set that has an explicit model/contract policy.

Team-specific corner/card totals and double chance are not assumed to have a directly equivalent price endpoint in the current parser; those remain manual rather than synthesizing prices.

## Plan boundary

Full tick-by-tick odds movement history (`/fixtures/{id}/odds/history`) is an Ultra capability; Pro keys receive `403 insufficient_plan`. Bookmakers beyond the Pro Bet365 package are also Ultra territory. Therefore the current $5 plan cannot provide every price movement or multi-bookmaker comparison.

For the current product, upgrading plans is not the first priority. The larger immediate gain is to exploit the Pro historical snapshots and standings more rigorously, then validate whether those features improve out-of-sample performance.

## Card settlement audit

Bet365's Number of Cards settlement states:

- yellow card = 1;
- red card = 2;
- second yellow is ignored for settlement;
- cards to non-players do not count;
- scheduled 90 minutes is the relevant period.

5Dollar provides aggregate yellow/red counts and event timelines, but the documented card events do not expose enough player identity to guarantee removal of second-yellow dismissals/non-player cards.

The backend therefore now uses `yellow + 2 * red` as a **Bet365 card-points proxy**, versioned as `cards-bet365-points-proxy-v2`. This fixes the previous one-for-one red-card error but remains experimental and must not be described as exact settlement equivalence.

## Recommended API roadmap

1. Keep current batch odds preflight and exact-line guard.
2. Build a historical opening/closing Bet365 snapshot table for validation and CLV.
3. Add corner/card standings as optional prior features, tested walk-forward.
4. Benchmark event/first-half and historical stats features only where they improve out-of-sample scoring.
5. Add explicit `/v1/status` observability for plan/rate usage only if operational monitoring becomes necessary; do not spend requests on every user page.
6. Consider Ultra only if full tick history or multi-bookmaker price comparison becomes a demonstrated bottleneck.

## Verdict

The backend is using the most important operational Pro capabilities for the current market scope, especially after `card_line` support and batch odds preflight. It is **not yet using the full analytical potential** of the Pro dataset. The best unused value is historical opening/closing snapshots plus corner/card standings, not indiscriminately enabling every available betting market.
