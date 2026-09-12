# Security Policy

## Scope

This repository is a portfolio case for a private, authenticated sports-decision application. Security controls cover the web application, server functions, Lovable Cloud data layer, external API boundaries and repository supply chain.

## Reporting a vulnerability

Please do not open a public issue containing credentials, tokens, personal data, exploit payloads or other sensitive evidence.

For a suspected vulnerability, open a private GitHub security report when that option is available for the repository. Include:

- affected component or route;
- reproducible steps;
- expected and observed behavior;
- impact assessment;
- the smallest safe proof of concept needed to demonstrate the issue.

Do not include real secrets or third-party personal data in the report.

## Security expectations

The project is designed around the following controls:

- authentication and authorization are enforced server-side;
- privileged Lovable Cloud access is restricted to server modules;
- row-level access and database RPC boundaries are covered by regression tests;
- migrations are versioned and tested before merge;
- secrets are scanned in CI and must never be committed;
- dependency vulnerabilities at high severity fail CI;
- critical changes require governance documentation and green automated checks.

## Supported version

Only the current `main` branch and the currently published Lovable deployment are considered supported. Historical branches and old commits are retained only as development history and are not security-maintained releases.

## Responsible testing

Do not test against accounts, data, infrastructure or third-party services you do not own or have explicit permission to assess. Avoid destructive testing against production. Prefer local regression tests and transactional Lovable Cloud checks that can be rolled back.

## Disclaimer

The application is experimental, does not execute bookmaker bets and is not a financial product. Security reports should focus on software, data and infrastructure risks rather than expected betting outcomes.