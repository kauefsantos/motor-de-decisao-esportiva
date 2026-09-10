# Backend Audit Close — 2026-09-10

## Scope

This close note records the backend state after the experimental market-policy refactor. The detailed market/statistical policy remains in `docs/BACKEND_MARKET_POLICY_2026-09-10.md`.

Lovable Cloud is the source of truth for live runtime/data. GitHub `main` is the source of truth for versioned code, tests and business rules.

## Implemented and validated

- Experimental market policy is centralized in `src/lib/engine/market-policy.ts`.
- Totals use real bookmaker half-lines instead of asymmetric integer conversions.
- Quote anchors are separated from bounded statistical reference ladders.
- A reference ladder line is never classified as value without a real odd for the exact line.
- Experimental value no longer uses the 75% raw probability gate as a prerequisite. The production `BASE_GATE` is unchanged.
- Goals in this flow are limited to match O/U 2.5, 1X2 and double chance; team-goal totals and BTTS were removed from this experimental quotation flow.
- Manual alternate-promotion paths were aligned with the same policy and reject stale catalogue rows.
- Match-card Bet365 `card_line` prices are now parsed/fetched automatically when the real bookmaker line matches the 4.5 anchor.
- Team-card, team-corner and double-chance prices remain manual because the currently validated 5Dollar snapshot contract does not expose those exact products through the implemented parser.
- Weekday final selection remains at most 2 and weekend at most 3; no bet is forced.
- CI, experimental E2E, unit tests and production build passed on each merged implementation step.

## Live data state at audit close

The inspected 2026-09-11 run was created under the previous catalogue and still contained 1,545 experimental predictions. It had zero tracked bets in PROPOSED, OPEN, SETTLED or DECLINED state. Therefore it can be safely recalculated under the new catalogue.

The old rows are intentionally not deleted by an administrative SQL cleanup. `prepareExperimentalMarketsRun` replaces the experimental prediction set when the run is processed again. New runs use the current policy automatically.

## Residual backend risks

### 1. Quote-volume problem is reduced, not fully solved

A fully modeled match can still expose up to 20 quote anchors. With a large CSV this can still create too much manual work. The next recommended product/backend change is a progressive quotation funnel:

1. calculate every allowed quote-anchor probability internally;
2. automatically fetch/evaluate all bookmaker prices that the API exposes;
3. request manual odds only for unpriced market groups, ordered as an operational queue;
4. initially show a bounded batch rather than every unpriced market at once;
5. allow the user to request more markets instead of permanently excluding them;
6. never call a candidate `value` until a real price for that exact contract exists.

This should be a prioritization mechanism, not another raw-probability gate.

### 2. Historical prediction IDs are ordinal-based

Experimental prediction IDs currently depend on family + ordinal. A catalogue change can therefore reuse an old ID for a different contract if a historical run is recalculated. The current inspected run has no tracked bets, so there is no present collision there. Before general historical reprocessing, IDs should include an immutable policy/contract key or policy version.

### 3. Global bankroll concurrency

Per-row stale/double-submit transitions are protected, but bankroll confirmation is not serialized across different bets. Two concurrent confirmations for different bets can read the same available-balance snapshot. Recommended fix: perform balance validation + transition inside one database transaction/RPC protected by an advisory/row lock.

### 4. Correlated final selections

The final selector ranks individual opportunities by EV/edge. It does not penalize correlated selections from the same match (for example HOME and 1X, or strongly related totals). Add a portfolio-level correlation rule only after agreeing the intended business policy; do not silently discard positive-EV opportunities.

### 5. Card settlement definition

The current card model sums yellow + red counts one-for-one. Before production validation, confirm the exact 5Dollar raw card semantics against the exact Bet365 settlement contract used for the wager. Model target and bookmaker settlement must be identical.

### 6. Statistical validation remains experimental

Current models are useful baselines, not a claim of maximum statistical sophistication:

- corners: attack/defence shrinkage + Poisson;
- cards: same count-model structure, currently without referee/context features;
- goals: recency-weighted attack/defence + independent Poisson + Elo where applicable.

Recommended model roadmap remains Negative Binomial/overdispersion benchmarks for corners/cards, Dixon-Coles or bivariate Poisson for goals, time decay for corners/cards, referee/context features for cards, hierarchical shrinkage, walk-forward validation, probability calibration and closing-line benchmarking.

## Backend verdict

The business-rule refactor is accepted and the critical internal inconsistencies discovered during this audit were corrected. The backend is suitable for continued experimental use under the new market policy.

The backend audit is **closed for the requested market-rule refactor**, with the residual items above explicitly carried as the next backend roadmap. The progressive quotation funnel is the highest-priority follow-up because it directly addresses manual workload without corrupting value-betting logic.
