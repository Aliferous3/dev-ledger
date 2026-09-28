# Contributing to Dev Ledger

Contributions are welcome when they improve Dev Ledger without weakening its privacy, security, or data-minimization model.

## Before opening a pull request

1. Search existing issues and pull requests.
2. For a bug, include a minimal reproduction and expected/actual behavior.
3. For substantial product or architecture changes, open an issue first so scope can be agreed before implementation.
4. Never include private repository data, credentials, access tokens, database dumps, or production screenshots containing user data.

## Development setup

Requirements:

- Node.js 24
- npm

Install and start the fixture-only UI:

```bash
npm ci
npm run dev
```

To exercise Vercel API routes, copy `.env.example` to `.env.local`, use your own provider credentials, and run:

```bash
vercel dev
```

Real environment files are gitignored and must never be committed.

## Required checks

Before submitting:

```bash
npm run build
npm run typecheck
npm test
npm audit --audit-level=moderate
```

CI additionally performs full-history secret scanning and a synthetic Postgres recovery drill.

## Database changes

- Treat `migrations/` as forward-only production history.
- Keep migrations explicit and reviewable.
- Preserve RLS, grants, and `SECURITY INVOKER` boundaries.
- Do not add user-facing data fields unless the product actually needs them.
- Update recovery tests when schema scope changes.
- Never test destructive recovery procedures against production.

## Security-sensitive changes

Changes involving authentication, sessions, GitHub permissions, webhooks, database authorization, environment variables, CSP, analytics, or deletion behavior require corresponding regression tests.

Do not solve a permission problem by weakening RLS, exposing service credentials to the browser, broadening GitHub permissions, or introducing `SECURITY DEFINER` behavior without a documented security rationale.

## Product-data rules

Dev Ledger's operating rule is **collect metrics, not source code**.

Do not add persistent storage for:

- repository source code or file contents;
- commit messages;
- pull-request titles;
- GitHub email addresses;
- OAuth or installation access tokens; or
- raw webhook payloads;

unless the product model is deliberately changed and the legal/security documentation is updated in the same pull request.

## Pull requests

Keep PRs focused. A good PR includes:

- what changed;
- why;
- security/privacy impact;
- screenshots for visible UI changes;
- database or deployment implications;
- test evidence.

The pull-request template contains the release checklist.

## Style

Follow the existing TypeScript/React conventions and visual language. Prefer small components, explicit state, semantic HTML, keyboard-accessible controls, and reduced-motion support for animation.

## Reporting vulnerabilities

Do not use normal issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
