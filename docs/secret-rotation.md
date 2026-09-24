# Secret Rotation Runbook — Dev Ledger

Operational runbook for rotating every credential Dev Ledger uses. Pairs with
`security/secret-inventory.json` (the machine-readable source of truth for
classification — tests enforce that every inventoried secret has a section
here).

**This document contains no secret values. Never paste one in.**

Provider docs this runbook is based on:

- Vercel: [Cron Jobs — securing with `CRON_SECRET`](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [Environment Variables](https://vercel.com/docs/environment-variables)
- GitHub: [Managing private keys for GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps), [Authenticating to the REST API](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api), [Using webhooks with GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps)
- Supabase: [API keys](https://supabase.com/docs/guides/api/api-keys), [Migrating to new API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)

---

## Global rules

- **Rotate one secret at a time.** Finish the full cycle — deploy, verify,
  revoke — before touching the next one.
- Record *which* credential is being rotated and when (name + date, never the
  value).
- When the provider supports overlap (GitHub private keys, GitHub client
  secrets, Supabase secret keys), create the new credential **before**
  revoking the old one.
- Vercel environment variables are bound per deployment — **a redeploy is
  required** for any `Vercel environment variable` change to reach running
  functions.
- Update server-side storage only. Secrets never enter `src/`, git history,
  issues, PRs, logs, screenshots, or chat.
- Never use `printenv`/`env` dumps to "check" a value — verify by exercising
  the code path (see per-secret verification below).
- Never commit `.env*` files (`.gitignore` covers them; gitleaks scans both
  worktree and full git history on every PR).
- Keep rollback capability (old credential not yet revoked, old deployment
  still live) until verification completes.
- Routine rotation ≠ suspected compromise. See **Emergency compromise**.

## Rotation checklist

```text
[ ] Identify the secret (this runbook section + security/secret-inventory.json)
[ ] Generate the replacement at the provider (or locally for self-generated keys)
[ ] Store the replacement in the correct location (Vercel env / GitHub App settings / local .env.local)
[ ] Redeploy if the secret lives in a Vercel environment variable
[ ] Verify the affected path (per-secret steps below)
[ ] Check Vercel Runtime Logs + the security_events table for new errors
[ ] Revoke/delete the old credential at the provider
[ ] Verify the affected path again
[ ] Record the rotation (name + date — never the value)
[ ] Confirm no secret value entered source, history, issues, or logs
```

## How to verify after rotation

Shared verification primitives referenced below:

- **Runtime logs:** Vercel dashboard → project → Logs (Runtime). Runtime Logs
  carry the **full event taxonomy** — every event emits a structured JSON
  line here. Look for `security_internal_error` and rejection events
  (`same_origin_blocked`, `webhook_signature_invalid`, `cron_auth_failed`,
  `auth_callback_failed`) plus 5xx spikes.
- **`security_events` (Supabase):** query the table via the Supabase
  dashboard (service-role only). The table holds **only the
  anti-amplification persist subset** — `session_invalid`, `session_revoked`,
  `logout_completed`, `account_deleted`, `webhook_replay_blocked`. Perimeter
  rejections (`same_origin_blocked`, `webhook_signature_invalid`,
  `cron_auth_failed`, `auth_callback_failed`, `security_internal_error`) are
  **console-only by design** — anonymous traffic must not be able to force
  DB writes. Check Runtime Logs for those, not the table.
- **Health:** `GET https://devledger-app.vercel.app/api/health` → 200.
- **Auth path:** sign in through the OAuth flow in a private window.
- **Sync path:** authenticated `POST /api/sync` → confirm rows update.
- **Webhook path:** GitHub App settings → Recent Deliveries → redeliver a
  ping, expect 200.
- **Cron path:** check the cron run in Vercel's deployment/cron view after the
  next scheduled tick, or watch Runtime Logs for `cron_auth_failed` lines
  (console-only event — it never reaches `security_events`).

---

## `SESSION_SECRET`

- **What it does:** the `password` iron-session uses to seal the
  `dev_ledger_session` cookie (`lib/config.mjs`). The seal protects `userId`,
  `sid`, `leaseUntil`, and `persistent`.
- **Where it lives:** Vercel env (Production). Self-generated — no external
  provider.
- **Rotation:** **all sessions are invalidated.** A cookie sealed under the
  old key cannot be unsealed under the new one — every user is signed out and
  must complete OAuth again. This is the correct behavior for a compromise;
  for routine rotation, schedule it for a low-traffic window.
- **Overlap:** not supported by the current implementation — `password` is a
  single string. Multi-key session sealing (iron-session password arrays)
  is a deliberate non-feature: the forced global re-auth on rotation is
  acceptable at this scale and is the safer default under compromise.
- **Procedure:**
  1. Generate a new high-entropy secret (≥32 random bytes).
  2. Update the Vercel Production env var.
  3. Redeploy.
  4. Verify: health 200; sign in fresh in a private window; existing tabs
     fall back to the login screen (expected).
  5. Nothing to revoke at a provider — the old value is retired once the env
     var is replaced.
- **Rollback:** restore the previous value and redeploy. Note: sessions
  sealed under the *new* key then die in turn — rollback is itself a global
  sign-out.

## `SECURITY_EVENT_HASH_KEY`

- **What it does:** dedicated HMAC-SHA256 key that turns `userId`/delivery ids
  into `actor_hash`/`source_hash` in `security_events` — correlation without
  storing raw identifiers (`lib/security-events.mjs`).
- **Where it lives:** Vercel env (Production). Self-generated.
- **Rotation impact:** **availability: none.** Events emitted after rotation
  hash under the new key, so new rows can't be correlated with rows hashed
  under the old key. Old-hash rows age out naturally via 30-day retention
  (`pruneSecurityEvents` in `/api/cron/sync`). Unset is also safe — hashes
  become `null`.
- **Overlap:** none — a single active key; historical and future hashes
  cannot be correlated across the change, but rotation causes **zero
  availability impact** (correlation is best-effort, never on an auth path).
- **Procedure:**
  1. Generate a new random key (≥32 bytes).
  2. Update the Vercel env var → redeploy.
  3. Verify: trigger a persisted event (e.g. sign out → `logout_completed`)
     and confirm the row has a non-null `actor_hash` — only if the key was
     set before too.
  4. Nothing to revoke.
- **Emergency:** if the key leaks, rotate it — attackers could otherwise
  confirm whether a *known* user id appears in `security_events`. Severity is
  low: the key cannot unhash anything without a candidate id.

## `CRON_SECRET`

- **What it does:** bearer token for `/api/cron/sync`. Per Vercel docs, when
  `CRON_SECRET` is set on the project, Vercel automatically sends
  `Authorization: Bearer <value>` on every cron invocation; the endpoint
  compares header to env (`api/cron/sync.mjs`).
- **Where it lives:** Vercel env (Production). Self-generated — Vercel
  recommends ≥16 random chars; use ≥32.
- **Overlap / downtime:** no dual-secret support, but rotation is effectively
  atomic: the cron sender and the endpoint both read the *same* env var per
  deployment. Old deployments send and expect the old value; new deployments
  send and expect the new value. Cron jobs hit the production deployment, so
  after redeploy both sides match.
- **Procedure:**
  1. Generate a new random string.
  2. Update the Vercel Production env var.
  3. Redeploy (required — env changes only apply to new deployments).
  4. Verify: wait for the next scheduled run; confirm Runtime Logs show no
     `cron_auth_failed` lines (console-only event) and that
     `security_events` pruning still runs.
- **Rollback:** restore the old value and redeploy.
- **Emergency:** rotate immediately — a leaked `CRON_SECRET` lets anyone
  trigger sync runs (DB/ingress amplification). Follow the same steps; there
  is no provider-side revocation, the env var is the credential.

## `GITHUB_APP_PRIVATE_KEY`

- **What it does:** signs the JWTs used to mint installation access tokens
  for GitHub-ingest (sync + webhook writes).
- **Where it lives:** Vercel env (Production), issued by GitHub.
- **Overlap:** **supported.** GitHub allows up to 25 private keys per app and
  explicitly recommends keeping multiple keys to rotate without downtime.
  Keys never expire; GitHub stores only the public portion.
- **Procedure:**
  1. GitHub → app settings → **Private keys → Generate a private key**. The
     PEM downloads once — store it only in the Vercel env var.
  2. Update `GITHUB_APP_PRIVATE_KEY` in Vercel (newline-safe format the app
     expects — check how the current value is stored and match it).
  3. Redeploy.
  4. Verify: trigger `POST /api/sync` while signed in — a minted installation
     token proves the new key works. Optionally compare the SHA-256
     fingerprint per GitHub's docs:
     `openssl rsa -in key.pem -pubout -outform DER | openssl sha256 -binary | openssl base64`.
  5. Delete the old key under **Private keys** (GitHub requires ≥1 key to
     remain, so deletion order is safe).
  6. Re-verify sync once.
- **Rollback:** redeploy with the old PEM — valid until step 5 deletes it.
- **Emergency:** compromised key → generate new, deploy, verify, delete old.
  The old key can mint installation tokens for every repo the app is
  installed on — treat as high severity.

## `GITHUB_CLIENT_SECRET`

- **What it does:** OAuth token exchange — `code` → user access token at
  `/api/auth/callback`.
- **Where it lives:** Vercel env (Production), issued by GitHub.
- **Overlap:** **supported.** The app settings page lists client secrets
  plural — GitHub Apps accept multiple active client secrets, so a
  generate → deploy → delete sequence has no outage.
- **Procedure:**
  1. App settings → **Client secrets → Generate a new client secret**.
  2. Update the Vercel env var → redeploy.
  3. Verify: complete a fresh OAuth sign-in in a private window. Watch
     Runtime Logs for `auth_callback_failed` / `token_exchange` lines
     (console-only events) — none means the new secret works.
  4. Delete the old secret in **Client secrets**.
  5. Re-verify a sign-in.
- **Rollback:** restore the old value + redeploy while it still exists.
- **Impact note:** a bad secret only breaks *new* sign-ins — existing sealed
  sessions keep working.

## `GITHUB_WEBHOOK_SECRET`

- **What it does:** verifies `X-Hub-Signature-256` on every delivery to
  `/api/webhooks/github` (HMAC-SHA256 over the raw body).
- **Where it lives:** two places that must agree — GitHub App settings
  (**Webhook secret** field) and the Vercel env var.
- **Overlap:** **none.** A GitHub App has exactly one webhook secret field,
  and the current implementation accepts exactly one secret. **Zero-downtime
  rotation is not possible today** — there is a window where GitHub signs
  with the new secret while a not-yet-redeployed function verifies with the
  old one (or vice versa).
- **Minimizing the gap:**
  1. Update the Vercel env var to the new secret.
  2. Redeploy.
  3. Immediately update the GitHub App webhook secret.
  4. During the gap (deploy propagation + the dashboard edit) deliveries
     fail with 401 — watch Runtime Logs for `webhook_signature_invalid`
     lines (console-only event). **GitHub does not automatically redeliver
     failed deliveries** — after both secrets match, open app settings →
     **Recent Deliveries** and manually redeliver each failed delivery (or
     use the redelivery API). GitHub currently allows redelivery of
     deliveries from the past **3 days**.
  5. Verify: redeliver a recent delivery → expect 200 and ingestion.
- **Alternative order** (rotate GitHub first, then Vercel): same-size gap —
  pick whichever coordination is faster.
- **Rollback:** set both sides back to the old secret.
- **Follow-up proposal (not implemented):** a `GITHUB_WEBHOOK_SECRET_PREVIOUS`
  grace-secret accepted for a bounded window would make rotation truly
  zero-downtime. Deferred deliberately — the cutover window is minutes and
  missed deliveries are recoverable via redelivery; revisit if webhook
  volume makes even a short gap unacceptable.

## `SUPABASE_SERVICE_ROLE_KEY`

- **What it does:** the server-side Supabase credential (`lib/config.mjs`
  `serviceKey`) — bypasses RLS for sync writes, session/sid lookup,
  `security_events` inserts. A wrong or revoked key is **user-visible
  downtime**: `requireUser`/`isSessionLive` hit `auth_sessions`, so
  authenticated API calls fail/401, sync stops, and every DB-backed feature
  breaks until the key is corrected. Existing session *records* are not
  deleted — restoring a valid key recovers sessions without forced re-login.
- **Where it lives:** Vercel env (Production), issued by Supabase.
- **Current provider reality (important):** Supabase is deprecating the
  legacy `anon`/`service_role` JWT keys in favor of `sb_publishable_` /
  `sb_secret_` keys. **Both systems work simultaneously** — new secret keys
  coexist with legacy keys until the legacy keys are disabled.
- **Preferred rotation (overlap-capable):**
  1. Supabase dashboard → **Settings → API Keys** → create a **new secret
     key** (`sb_secret_…`).
  2. Update `SUPABASE_SERVICE_ROLE_KEY` in Vercel to the new value → redeploy.
  3. Verify: health 200, sign-in works, `POST /api/sync` writes rows, and no
     `security_internal_error`/DB permission errors in runtime logs.
  4. Retire the old credential: delete the old secret key, or — if the old
     value was a legacy `service_role` JWT — **deactivate legacy keys** in the
     same section (reversible, so re-enable if something was missed).
  5. Re-verify.
- **If still on the legacy JWT and not migrating:** the legacy key is tied
  to the project's JWT signing secret — rotating it invalidates all legacy
  keys at once (no overlap, brief outage). Prefer the `sb_secret_` path above.
- **Emergency:** compromised service-role key is the highest-severity leak —
  it bypasses all RLS. Issue new secret key → deploy → verify → deactivate
  legacy keys / delete the leaked key, in that order, without waiting.

## `SUPABASE_DB_PASSWORD`

- **What it does:** Postgres password for `npm run db:migrate`
  (`scripts/migrate.mjs`) through the session pooler. **Operator-local only**
  — it lives in a maintainer's `.env.local`, not in Vercel production.
- **Where it lives:** operator `.env.local`; issued/managed in the Supabase
  dashboard (Database settings).
- **Rotation:**
  1. Supabase dashboard → project → **Database** settings → reset the
     database password.
  2. Update `SUPABASE_DB_PASSWORD` (and/or `DATABASE_URL` — it embeds the
     same password, percent-encoded) in the operator's `.env.local`.
  3. Verify: `npm run db:migrate` reaches the DB and reports migrations
     up-to-date.
- **Overlap:** none — reset replaces the password immediately. App impact:
  none (the running app never uses it).
- **Emergency:** reset immediately. A leaked DB password grants direct
  Postgres access bypassing every API-layer control.

## `DATABASE_URL`

- **What it does:** optional full Postgres connection string for
  `db:migrate` — an alternative to `SUPABASE_DB_PASSWORD` + pooler host/port.
  Operator-local only.
- **Rotation:** rotates *with* `SUPABASE_DB_PASSWORD` (the password is inside
  the URL). Update the local value; nothing else changes. If both are set,
  `DATABASE_URL` wins — keep them consistent.

## `VERCEL_TOKEN`

- **What it does:** Vercel account/CLI API token. **Not referenced by any
  repo code or CI workflow** — inventoried so an operator-local token is still
  classified and guarded.
- **Where it lives:** operator's local environment (or CI secrets if a
  workflow ever needs it). Issued at Vercel → Account Settings → **Tokens**.
- **Rotation:** create a new token → update wherever the old one is stored →
  verify (`vercel whoami` / the consuming job) → delete the old token in the
  Vercel UI. Overlap supported (multiple tokens coexist). No app impact.

---

## Emergency compromise

Different posture from routine rotation: **contain first, then rotate.**

1. **Contain.** Identify scope — which credential, what can it reach (see the
   inventory's `rotationImpact`). If a value reached git history, treat it as
   fully public.
2. **Rotate/revoke immediately** following the per-secret emergency notes
   above — don't wait for a quiet window. Priority order if several leaked:
   `SUPABASE_SERVICE_ROLE_KEY` and `GITHUB_APP_PRIVATE_KEY` first (broadest
   reach), then `SUPABASE_DB_PASSWORD`, `GITHUB_CLIENT_SECRET`,
   `GITHUB_WEBHOOK_SECRET`, `SESSION_SECRET`, `CRON_SECRET`,
   `SECURITY_EVENT_HASH_KEY`, `VERCEL_TOKEN`.
3. **Redeploy** after env changes.
4. **Revoke sessions where relevant:** rotating `SESSION_SECRET` already
   invalidates all sessions — the correct response to any compromise that may
   have exposed session material.
5. **Inspect evidence:** Runtime Logs carry the full taxonomy — look for
   `session_invalid`/`session_revoked` spikes, `webhook_signature_invalid`,
   `cron_auth_failed`, `auth_callback_failed`, unexpected `account_deleted`.
   The `security_events` table shows only the persisted subset
   (`session_invalid`, `session_revoked`, `logout_completed`,
   `account_deleted`, `webhook_replay_blocked`) — perimeter rejections are
   console-only and will only appear in Runtime Logs.
6. **Check for source leaks:** run gitleaks over worktree + full history
   (the CI workflow already does both); scrub/rotate anything found.
7. **Document the incident** — timeline, scope, actions — without writing
   any secret value into the record.
