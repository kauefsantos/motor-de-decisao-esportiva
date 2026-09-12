# Performance and scalability baseline — 2026-09-12

This document records the performance/scalability controls introduced after the measured production audit. It does not change quantitative betting rules.

## Measured baseline before remediation

- Lovable Cloud database: about 296 MB.
- `raw_observations`: about 239 MB and roughly 80% of database size.
- Recent end-to-end background analyses: about 381–390 seconds.
- Hot `run_id` reads for `model_predictions`, `normalized_match_stats` and `source_fetches` were observed using sequential scans.
- A raw-observation cache preload fetched up to 5,000 JSON rows (roughly 4.9 MB in the sampled production query) before selecting cache keys in application memory.
- The football provider budget is intentionally capped at 9 requests/minute, shared across instances, below the provider's documented Pro cap of 10/minute.

## Controls

1. Hot-path indexes are versioned in migrations and verified by pgTAP.
2. Raw provider payloads from finalized/completed analyses are retained for 90 days; normalized/model/decision outputs remain available. Source-fetch and pipeline-log operational telemetry is retained for 180 days.
3. Raw cache lookup is keyed and index-backed. The application must not restore the former unconditional 5,000-row preload.
4. Home and bankroll summary metrics are aggregated in SQL. Owner-scoped history is resolved inside the database rather than expanding all owned run IDs in application memory.
5. Elo and provider maintenance jobs yield while analysis jobs are queued/running and use advisory locking to avoid overlapping maintenance.
6. Real-user monitoring stores only metric, value, rating, route and timestamp for LCP, CLS, INP and TTFB. No account identifier is stored in `performance_vitals`; ingestion remains authenticated and server-side.
7. Client bundle CI budget: largest JavaScript asset <= 115 KiB gzip; largest CSS asset <= 20 KiB gzip. Any increase requires deliberate review rather than silent growth.
8. CI runs a public-route concurrency smoke test. It is a regression gate, not a substitute for authenticated production load testing.
9. Provider rate limiting is a hard external constraint and must not be bypassed for throughput. Scaling should come from reuse/cache/queue discipline rather than exceeding the provider contract.
10. Core decision methodology, probability gates, portfolio rules and idempotency remain unchanged by this package.

## Real-user targets

- LCP: good <= 2.5 s.
- INP: good <= 200 ms.
- CLS: good <= 0.1.
- TTFB: good <= 800 ms.

These values are monitoring targets. A small or absent production sample must never be represented as proof that the target is met.

## Residual limitations

The application currently authorizes one approved Google account by product/security design. The load smoke validates runtime regressions under concurrent HTTP requests, but it does not certify multi-user product behavior. The provider's 9-request/minute operational budget remains the dominant throughput ceiling for cache misses.
