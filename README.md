# Dev Ledger / BODY OF WORK

Your GitHub history, made legible.

Dev Ledger is a private, per-user developer analytics dashboard. A visitor signs
in with GitHub, authorizes the Dev Ledger GitHub App on all or selected
repositories, and gets a personal "body of work" — commits, churn, pull
requests, languages, momentum — built entirely from GitHub-authorized data.

No local software, no tokens to paste, no cloc, no manual repository uploads.

## Product

- **Landing** — minimal login screen: *Continue with GitHub*.
- **Overview** — net source growth, lines added/deleted, churn, commits, pull
  requests, active days, streaks, contribution field, projects ranked by churn,
  language composition.
- **Projects** — authorized repositories ranked by momentum, with churn,
  commits, active days, primary language, last activity.
- **Activity** — contribution heatmap, weekday × hour rhythm, streaks,
  extremes, milestones.
- **Code** — language bytes, added/deleted/net/churn, refactor and retention
  ratios, churn by repository.
- Date ranges (7D / 30D / 90D / YTD / 1Y / ALL / custom) and previous-period
  comparison are computed from stored data — never live GitHub calls.

## Architecture

```
Browser (Vite + React)
  └── /api/*           Vercel serverless functions (Node)
        ├── auth/*     GitHub App OAuth web flow (iron-session cookie)
        ├── setup      post-installation redirect (GitHub App Setup URL)
        ├── dashboard  aggregated read endpoint (Supabase RPC)
        ├── sync       bounded, resumable ingestion (POST runs ~20s slice)
        ├── user       profile, installations, account deletion
        ├── webhooks/github   signature-verified app webhooks
        └── cron/sync  Vercel Cron continuation for background sync
  └── Postgres (Supabase) — users, installations, repositories, languages,
      commits, pull requests, repo_sync cursors, user_sync status
```

### Data flow

1. `/api/auth/login` → GitHub OAuth authorize → `/api/auth/callback` exchanges
   the code, upserts the user (keyed by immutable `github_user_id`), and records
   app installations. If none exist the user is sent through the app install
   flow, which returns to `/api/setup`.
2. The client pumps `POST /api/sync` — each call runs a bounded slice of work
   (discover → metadata → commits → pulls) and persists cursors in `repo_sync`,
   so ingestion resumes across invocations and survives tab closes. Vercel Cron
   (`/api/cron/sync`) continues in-flight syncs every 15 minutes.
3. `/api/dashboard` reads only stored, normalized rows via `dash_daily`,
   `dash_repos`, and `dash_rhythm` SQL functions — all scoped by the internal
   `user_id` from the server-side session.

### Commit attribution

A commit counts only when GitHub links its author identity to the
authenticated user's account (GraphQL `history(author: {id: <node-id>})` plus a
defensive `author.user.id` check). Commits by other authors, bots, and unlinked
emails are excluded. Merge commits authored by the user are included.
Additions/deletions/changedFiles come from the same GraphQL query — one call
per 100 commits, no per-SHA detail fetches.

## GitHub App setup

1. Create a GitHub App (Settings → Developer settings → GitHub Apps):
   - **Callback URL**: `{APP_URL}/api/auth/callback`
   - **Setup URL**: `{APP_URL}/api/setup` (check "Redirect on update")
   - **Webhook URL**: `{APP_URL}/api/webhooks/github`, set a webhook secret
   - **Permissions** (repository, read-only):
     - Contents: Read *(commits + language data)*
     - Pull requests: Read
     - Metadata: Read *(automatic)*
   - **Subscribe to events**: `push`, `pull_request`, `installation`,
     `installation_repositories`
   - Enable "Request user authorization (OAuth) during installation" for the
     smoothest single-screen flow.
2. Copy values into `.env` (see `.env.example`): app id, app slug, OAuth client
   id/secret, PEM private key, webhook secret.

## Database setup

Supabase (or any Postgres):

```bash
DATABASE_URL="postgres://..." npm run db:migrate
```

Migrations live in `migrations/` (`001_initial.sql`, `002_sync_and_analytics.sql`)
and are applied in filename order.

## Local development

```bash
npm install
vercel dev        # serves the SPA + /api functions on http://localhost:3000
```

Or run the UI separately on `:5173` (it proxies `/api` to `:3000`):

```bash
npm run dev       # vite
vercel dev        # in another shell, for the API
```

## Tests

```bash
npm test
```

Covers analytics math (streaks, churn, summary), commit attribution rules,
date-range validation, and auth gating (unauthenticated requests → 401,
unsigned webhooks → 401).

## Deployment

Push to GitHub and import the project into Vercel. Set all env vars from
`.env.example`, run `npm run db:migrate` against production Postgres, and point
the GitHub App's callback/setup/webhook URLs at the production origin. The
`crons` block in `vercel.json` registers the background sync continuation;
set `CRON_SECRET` so only Vercel can call it.

## Security model

- Session is an `iron-session` sealed, httpOnly cookie (`Secure` + `SameSite=Lax`
  in production). GitHub tokens never reach the browser.
- The session identifies the internal `users.id`; client-supplied ids are never
  trusted. Every query is scoped `eq('user_id', …)` — enforced in
  `lib/require-user.mjs` and inside each aggregation RPC's `p_user` parameter.
- OAuth `state` is stored in the session and verified in the callback.
- Webhook payloads are HMAC-SHA256 verified with `GITHUB_WEBHOOK_SECRET`.
- Service-role DB access stays server-side; no public/read access is exposed.
- GitHub access is read-only; the app never writes to repositories.
- `DELETE /api/user?confirm=1` deletes the user's row and all cascaded data,
  then destroys the session. The GitHub App installation itself is removed by
  the user from GitHub settings.
