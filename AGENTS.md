# Dev Ledger — contributor and coding-agent notes

These notes define the public development contract for humans and coding agents working in this repository. They supplement [CONTRIBUTING.md](CONTRIBUTING.md).

## Core commands

- Install: `npm ci`
- Dev UI: `npm run dev`
- Full local API stack: `vercel dev`
- Build: `npm run build`
- Typecheck: `npm run typecheck`
- Test: `npm test`
- Dependency audit: `npm audit --audit-level=moderate`
- Database migration: `npm run db:migrate`
- Local recovery drill: `npm run db:drill`

## Product invariants

Dev Ledger is a read-only developer-analytics product. Preserve these invariants unless a deliberate product decision changes them:

- collect metrics, not repository source code;
- do not persist commit messages, pull-request titles, GitHub email addresses, OAuth tokens, installation tokens, or raw webhook payload bodies;
- keep GitHub repository permissions read-only;
- keep server credentials out of browser code and production bundles;
- preserve tenant isolation and least-privilege database access;
- keep user-facing repository disconnect, deletion, and account-deletion behavior intact.

## Security-sensitive changes

Changes involving authentication, sessions, GitHub permissions, webhooks, database authorization, environment variables, CSP, analytics, deletion, or recovery require regression coverage.

Do not weaken security controls merely to make a test or local setup pass. Do not commit secrets, production data, private repository content, database dumps, private keys, or real user screenshots.

## Fixtures and local development

Plain Vite development uses synthetic fixtures. Production behavior must never fall back to fixture telemetry when live API data is unavailable.

Use your own local credentials from `.env.local` when exercising provider integrations. Real environment files are gitignored.

## Database work

Treat `migrations/` as forward-only production history. Preserve RLS and least-privilege grants. Never run destructive recovery work against production.

See:

- [Architecture](docs/architecture.md)
- [Disaster recovery](docs/disaster-recovery.md)
- [Secret rotation](docs/secret-rotation.md)
- [Security policy](SECURITY.md)

## Pull requests

Keep changes focused. Before submitting, run the required checks in [CONTRIBUTING.md](CONTRIBUTING.md), document security/privacy implications, and include tests for changed behavior.

Contributions are subject to the [Contributor License Agreement](CONTRIBUTOR_LICENSE_AGREEMENT.md).
