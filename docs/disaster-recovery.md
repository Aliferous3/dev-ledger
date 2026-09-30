# Disaster Recovery Runbook — Dev Ledger

Operator runbook for recovering Dev Ledger from data loss or platform loss.
Pairs with `docs/secret-rotation.md` (credential procedures) and
`security/secret-inventory.json` (metadata-only credential inventory).

**This document contains no secret values. Never paste one in.**

Provider reality verified against current docs (Supabase *Database Backups*):

- **Free plan has NO automatic provider backups.** Supabase explicitly
  recommends Free projects take their own logical dumps (`pg_dump` /
  `supabase db dump`) and store them off-site. That is what `db:backup` does.
- **PITR is a paid add-on** (Pro/Team/Enterprise) — not available here.
- **Deleting the Supabase project permanently destroys all associated
  backups** — provider restore is impossible after project deletion; the
  off-site logical dumps are the only recovery path.
- Database backups do not cover Supabase Storage objects — **Dev Ledger does
  not use Supabase Storage** (no storage API usage in `lib/`, `api/`, `src/`),
  so the database dump is complete coverage.

---

## Recovery priorities

1. Stop further corruption/writes if necessary
2. Preserve evidence
3. Determine the latest known-good backup
4. Reconstruct infrastructure
5. Restore schema (repo migrations — the source of truth)
6. Restore core data (`pg_restore --data-only`)
7. Recreate secrets/control-plane configuration
8. Verify security boundaries
9. Restore traffic
10. Force/restart resync where appropriate
11. Monitor closely

## Recovery architecture

```
fresh Postgres 17 (Supabase project or compatible)
    ↓ create roles: anon, authenticated, service_role   (Supabase supplies these)
    ↓ npm run db:migrate          → schema + RLS + grants + views/functions
    ↓ pg_restore --data-only --single-transaction
                                  → core + operational rows from the dump
                                  (FK constraints ACTIVE — no superuser
                                  needed; the archive's recorded
                                  dependencies order the data correctly)
    ↓ ephemeral tables stay EMPTY by design (see below)
    ↓ recreate env vars / secrets per docs/secret-rotation.md
    ↓ users re-authenticate on next visit (auth_sessions intentionally empty)
    ↓ sync resumes: webhook pushes + daily cron continuation
```

**Schema is never in the dump.** The dump is `--data-only` only; repo
migrations are the authoritative schema/security definition and are replayed
first on any recovery target. `schema_migrations` is rebuilt by the runner.

**The dump is allowlist-only.** `pg_dump` is invoked with repeated
`--table=public.<name>` for exactly `BACKUP_TABLES` — never a whole-database
dump. Supabase warns that raw `pg_dump` can include platform-internal
schemas/objects; the allowlist guarantees an unknown or newly added
schema/table is *not* backed up until explicitly classified in
`scripts/backup-scope.mjs` (and CI fails loudly on any unclassified table).

### Table classification (scripts/backup-scope.mjs is the code-level truth)

| Table | Class | In backup? | Reason |
|---|---|---|---|
| `users` | core | yes | account identity — irreplaceable |
| `github_installations` | core | yes | installation↔user link — resync anchor |
| `repositories` | core | yes | tracked repos + disconnect state |
| `repository_languages` | core | yes | language byte-share stats |
| `commits` | core | yes | ingested history — expensive to rebuild |
| `pull_requests` | core | yes | ingested PR rows (no titles/numbers/authors by design) |
| `repo_coverage` | operational | yes | derived but needs full re-ingest to rebuild — cheap to keep |
| `repo_sync` | operational | yes | phase markers; self-healing hints |
| `user_sync` | operational | yes | stale `syncing`/`locked` rows are taken over by cron's stale-lock logic |
| `auth_sessions` | ephemeral | **no** | recovery must force re-auth, never resurrect live sids |
| `webhook_deliveries` | ephemeral | **no** | dedup history; post-restore deliveries reprocess idempotently |
| `security_events` | ephemeral | **no** | 30-day operational telemetry |
| `schema_migrations` | rebuilt | **no** | written by the migration runner |

### RPO / RTO (honest Free-plan numbers)

- **RPO = age of the latest verified manual `db:backup` dump.** With real
  users, take a daily backup (≤24h worst-case loss) plus a mandatory fresh
  dump immediately before any production schema migration.
- **RTO = best-effort, not an SLA.** At ~13 MB the dump/restore itself is
  seconds-to-minutes; the dominating steps are manual: project recreation,
  secret re-entry, Vercel redeploy, and verification. Realistic target:
  **hours**, not minutes.
- **Paid-plan trigger:** once losing up to a day of real-user data is
  unacceptable, re-evaluate Supabase Pro (daily backups) or PITR. Do not
  enable either silently — it's a plan decision.

### Backup retention baseline

- daily backups: keep **7**
- weekly backups: keep **4**
- pre-migration backup: retain until the migration is independently verified
- artifacts live only in `.recovery/` locally (gitignored) and then an
  encrypted vault/off-site store. They contain GitHub usernames, repository
  metadata (incl. private-repo names), commit stats, and user/account
  records — treat as sensitive. No custom encryption is built in; rely on
  vault/disk/cloud encryption with a real recovery story.

---

## Scenario A — accidental row / partial-table loss

The dump is **data-only** — it has no DDL, so `--clean`/`--if-exists`
cannot drop and recreate app tables, and blind `TRUNCATE` is not the
normal recovery method. Recover through a scratch database:

1. Stop the relevant writes if corruption may be ongoing. **Caution:**
   pausing the Vercel cron only stops cron-triggered work — authenticated
   syncs, webhook ingestion, OAuth/account activity and other mutation
   endpoints still write. Full quiescence means restricting every write
   path (Dev Ledger has no single maintenance switch today); at minimum
   pause cron and avoid triggering syncs while you work.
2. `npm run db:backup` — snapshot the damaged state for evidence.
3. Identify the newest dump **predating** the loss.
4. Restore that dump into a **scratch** database (local Postgres 17 via
   the `db:drill` mechanics, or a scratch Supabase project — never
   production): `npm run db:migrate`, then
   `pg_restore --data-only --no-owner --no-privileges --single-transaction`.
5. Inspect the recovered rows in scratch; compare scratch vs production.
6. Construct a **reviewed, table-specific** recovery SQL/COPY operation
   that re-inserts only the lost rows under active FK constraints.
7. Apply it to production deliberately; verify with the checklist below.
8. Resume writes.

There is intentionally no automated production-destructive helper.

Expected data-loss window: time since that dump (the Free-plan RPO).

## Scenario B — bad migration / schema corruption

1. Stop deployments; if the app is erroring, roll back the Vercel deployment
   to the last good one (Deployments → ⋯ → Redeploy previous).
2. **Do not write a reverse migration blind.** Restore to a scratch database
   first and compare.
3. Criteria: forward-fix is acceptable when the corruption is additive and
   understood (e.g. a stray index). Restore-first is mandatory when data was
   dropped/corrupted or grants/RLS were weakened.
4. **Mandatory precondition for every future migration:** fresh
   `npm run db:backup` immediately before applying.
5. After fixing, run the recovery verification checklist.

## Scenario C — total Supabase project loss / deletion

Project deletion is irreversible — provider backups go with it.

1. Create a replacement Supabase project (Free), **same region where
   practical** (`ap-southeast-2` baseline — a different region changes
   latency, not correctness).
2. Set the DB password; build the operator connection string locally
   (`SUPABASE_DB_PASSWORD` + `SUPABASE_URL`/ref or `DATABASE_URL` in
   `.env.local` — never committed).
3. `npm run db:migrate` — replays 001→009, rebuilding schema, RLS, grants,
   views, functions, `schema_migrations`.
4. Restore the latest dump:
   `pg_restore --data-only --no-owner --no-privileges --single-transaction`
   against the **session pooler** (port 5432 — `SUPABASE_DB_HOST`/
   `SUPABASE_DB_PORT` defaults in `.env.example`; credentials via `PG*` env
   vars, never argv). No `--disable-triggers`: its emitted commands need
   superuser, which the managed `postgres` role does not have — the
   archive's recorded FK dependencies order the data correctly with
   constraints active (proven by `npm run db:drill`).
5. Get the new project’s API key: Supabase Dashboard → Settings → API Keys →
   create a **secret key** (`sb_secret_…`) — legacy `service_role` JWTs are
   deprecated.
6. Update Vercel Production env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
7. Redeploy. All users must sign in again (sessions were excluded from the
   dump — by design).
8. Run the full verification checklist; watch `security_events` + Runtime
   Logs for `session_invalid`/`cron_auth_failed` anomalies.
9. Sync resumes via webhook pushes and the daily cron continuation.

## Scenario D — Vercel project loss

**Repo-tracked (redeploy restores):** source, `vercel.json` (build command,
framework `vite`, `functions.maxDuration` 60s on `api/sync.mjs`,
`api/sync-range.mjs`, `api/cron/sync.mjs`, cron `0 2 * * *` → `/api/cron/sync`,
rewrites `/overview` `/activity` `/code` → `/index.html`, security headers
incl. CSP), all code, migrations.

**Control-plane state to reconstruct (not in source):**

- Production env var **names** — the complete list is
  `security/secret-inventory.json` (values come from the secret store /
  rotation runbook, never the repo).
- Production custom domain — `devledger.site`; re-point DNS to the replacement deployment if infrastructure is recreated.
- Deployment Protection — expected: preview protection requires login.
  *(operator verification item — not verifiable from the repo)*
- Firewall/WAF — expected posture: custom observation rules on auth login,
  sync mutations, and the GitHub webhook; Bot Protection logging; AI Bots
  allowed; Attack Mode off. *(operator verification item; do not change in
  this tranche.)*
- Project settings not represented in source (e.g. Node runtime major —
  Node 24 expected per CI `setup-node` and `@types/node` 24).

## Scenario E — GitHub App configuration loss

Reconstruct from app settings (values in `.env.example` names, non-secret):

- **Callback URL:** `https://<app-origin>/api/auth/callback`
- **Setup URL:** `https://<app-origin>/api/setup`
- **Webhook URL:** `https://<app-origin>/api/webhooks/github`
- **Subscribed events (from the handler):** `push`, `pull_request`,
  `installation`, `installation_repositories`
- **Permissions used by code** *(operator verification item — confirm against
  app settings):* Contents read (commit history GraphQL, languages),
  Pull requests read (PR ingest via search), Metadata read (installation repo
  listing), plus user-facing OAuth (no explicit scope — GitHub App user
  tokens).
- **Private key:** never treat git/Vercel as escrow. Generate a new private
  key (apps support ≤25) → deploy → verify → delete the old — see
  `docs/secret-rotation.md` § `GITHUB_APP_PRIVATE_KEY`.
- **`GITHUB_CLIENT_SECRET`:** generate a replacement in the App settings
  (GitHub supports ≥2 concurrent client secrets for overlap) → update
  Vercel → redeploy → revoke old.
- **`GITHUB_WEBHOOK_SECRET`:** coordinated cutover per the rotation
  runbook — single field both sides; update the Vercel Production env first,
  redeploy, then immediately update the GitHub App webhook secret to the same
  value. Deliveries failing 401 during the short mismatch window are
  manually/API redeliverable for 3 days.

## Scenario F — lost self-generated secret

- `SESSION_SECRET` → generate new → all users sign in again (expected).
- `CRON_SECRET` → generate new → update Vercel env → redeploy.
- `SECURITY_EVENT_HASH_KEY` → generate new → historical hash correlation
  lost; availability unaffected.
- `VERCEL_TOKEN` → tooling only (not referenced by repo code/CI). Recreate
  at Vercel → Account Settings → Tokens and update wherever it was stored;
  multiple tokens coexist, so create → verify → delete old.

## Scenario G — lost database operator password

Reset it in Supabase → Database settings, update the operator `.env.local`
(`SUPABASE_DB_PASSWORD` / `DATABASE_URL`). The running app does not depend on
it — zero production impact.

---

## Recovery verification checklist

**Database**
- [ ] `schema_migrations` = all repo migrations applied
- [ ] core row counts plausible vs. the dump
- [ ] FK integrity (commits → repositories, etc.)
- [ ] RLS enabled on every app table
- [ ] `anon`/`authenticated` hold zero table privileges
- [ ] `service_role` holds only intended grants (incl. security_events
      select/insert/delete + sequence usage)
- [ ] `dash_*` functions are SECURITY INVOKER; dashboard views
      `security_invoker`
- [ ] minimized columns absent: `pull_requests.title`, `pull_requests.number`,
      `pull_requests.author_user_id`, `pull_requests.author_login`,
      `pull_requests.closed_at`, `commits.message`, `commits.author_user_id`,
      `commits.author_login`, `commits.authored_at`, `commits.files_changed`,
      `commits.is_merge`
- [ ] `user_sync.error` / `repo_sync.error` contain only closed taxonomy
      codes (`GITHUB_RATE_LIMIT`, `GITHUB_ACCESS_REVOKED`,
      `SYNC_HISTORY_FAILED`, `SYNC_PULLS_FAILED`, `SYNC_INTERNAL_ERROR`)
- [ ] `auth_sessions` empty (re-auth forced), `webhook_deliveries` empty,
      `security_events` fresh
- [ ] a post-restore insert into `security_events` works (identity live)

**App**
- [ ] `/api/health` → 200
- [ ] fresh OAuth login succeeds
- [ ] `/api/user` authenticated round-trip
- [ ] dashboard loads
- [ ] `POST /api/sync` succeeds
- [ ] webhook redelivery → 200
- [ ] cron run authenticates (no `cron_auth_failed` in Runtime Logs)
- [ ] no new Vercel runtime errors

**Security**
- [ ] secrets recreated/rotated per docs/secret-rotation.md
- [ ] no backup file publicly reachable
- [ ] no backup committed to git (`git check-ignore .recovery/x.dump`)
- [ ] gitleaks clean on worktree + history
- [ ] Vercel deployment protection restored
- [ ] firewall posture restored per Section D

## The drill (proof, not prose)

`npm run db:drill` runs the entire path against a **local-only** Postgres:
creates scratch DBs, creates the `anon`/`authenticated`/`service_role` roles
migrations need, applies all migrations, seeds synthetic rows, runs the real
`db:backup` dump path, restores into a second migrated DB, and verifies data,
FKs, RLS, grants, invoker functions, privacy columns, and ephemeral-table
policy — then drops everything. It **refuses any non-localhost target**;
production restore stays a checklist-driven operator procedure.

CI runs the same drill on every PR against a Postgres 17 service container
with synthetic credentials and zero repository secrets.
