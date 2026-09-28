# Changelog

Notable user-facing and platform changes are recorded here.

## [1.3.0] — 2026-09-28

### Added

- Public open-source release under AGPL-3.0-only, with contributor licensing and a separate trademark policy.

- Three-page Dev Ledger interface: Overview, Activity, and Code.
- GitHub OAuth and GitHub App installation flow.
- Incremental repository, commit, pull-request, language, and history synchronization.
- Selectable 7D / 30D / 90D / YTD / 1Y / ALL / custom date ranges.
- Metric-driven growth, additions, deletions, churn, and commit graphs.
- Smoothed daily companion line and animated graph transitions.
- Activity extremes, circadian analysis, rhythm views, and milestones.
- Code composition, language, project, and growth views.
- Terminal-style share-card export.
- Feedback / bug / feature-request drawer with optional screenshot.
- Public Security & Privacy trust record.
- Public Privacy Policy and Terms of Service.
- Vercel Web Analytics.
- Privacy-limited PostHog product events.

### Security & privacy

- Read-only GitHub repository permissions.
- Server-side session revocation and inactivity leases.
- Same-origin protection for browser mutations.
- Webhook HMAC verification and delivery replay deduplication.
- Backend-only database access model with RLS and least-privilege grants.
- Removal of persisted commit messages and pull-request titles.
- Strict CSP with self-hosted fonts and no inline scripts.
- Full-history secret scanning and dependency auditing in CI.
- Synthetic Postgres migrate → backup → restore drill in CI.
- User-controlled repository disconnect/delete and account deletion.
