# Dev Ledger — agent notes

## Commands

- Test: `npm test` (node:test, no DOM runner — source-level guards where DOM is needed)
- Build: `npm run build` (Vite + vite-plugin-singlefile)
- Preview: `npm run dev` (plain Vite, no API — design/fixture mode) · `vercel dev` (real API routes)
- DB ops: `npm run db:migrate` (apply `migrations/` to the operator DB) · `npm run db:backup` (pg_dump `--data-only` of core tables → gitignored `.recovery/` + sha256 sidecar) · `npm run db:drill` (localhost-only synthetic migrate→dump→restore→verify; refuses non-local hosts). Operator env precedence: process env > `.env.local` > `.env` via `scripts/operator-env.mjs` — secrets ride `PG*` env vars, never argv/logs. Runbook: `docs/disaster-recovery.md`.

## Session / auth contract

One sealed iron-session cookie `dev_ledger_session` (`lib/config.mjs`, `lib/auth.mjs`):

- **Default (KEEP ME SIGNED IN unchecked):** true browser-session cookie — `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when the effective origin is https, **no Max-Age/Expires** — **plus a server-enforced sliding inactivity lease**: `leaseUntil` (epoch ms) sealed inside the session payload, minted at OAuth callback, renewed **only** by `POST /api/auth/heartbeat` (60s from open tabs + focus/visibility). `getSession` is validation-only — ordinary API traffic never slides the lease, so background polling can't keep an idle session alive. `SESSION_LEASE_MINUTES` (default **5**, `0` disables) without ANY Dev Ledger contact → expired server-side → login required. This makes "no activity = logged out" uniform across browsers, including Firefox Session Restore (which resurrects session cookies but cannot extend the lease). Sleep/offline > lease → sign-in required on return — intentional.
- **Remember (checked):** identical seal/format + `Max-Age` ~30 days. Only the outgoing persistence attributes differ — `persistent` flag rides inside the sealed cookie through the OAuth round-trip and is honored only after state validation.
- **Logout:** `POST /api/auth/logout` (POST-only, same-origin-guarded) destroys either variant (`Max-Age=0`) **and revokes the server-side session record**; the frontend POSTs then navigates to `/`.
- **CSRF:** all browser-triggered mutations (`POST /api/sync`, `POST /api/sync-range`, `POST`+`DELETE /api/user`, `POST /api/auth/heartbeat`, `POST /api/auth/logout`) pass `lib/same-origin.mjs` — Origin must equal `new URL(appUrl).origin` and `Sec-Fetch-Site` (when present) must be `same-origin`; missing/malformed → 403. Exempt by design: webhooks (HMAC), cron (`CRON_SECRET`), OAuth callback + setup redirects (GitHub navigates to them), all read-only GETs.

## Supply-chain / CI security

- `.github/workflows/security.yml` runs on every PR + push to main: `npm ci --ignore-scripts` → `npm run build` → `npm run typecheck` (strict `tsc --noEmit` — every PR is typechecked) → `npm test` (includes the dist/ artifact scan — build runs first so it inspects a real bundle) → `npm audit --audit-level=moderate` → ephemeral CycloneDX SBOM validation. `permissions: contents: read`, plain `pull_request` trigger, zero secrets declared. Install scripts are disabled deliberately — only `esbuild`/`fsevents` ship them (optional-binary fallbacks; platform binaries arrive as optional deps).
- Secret scanning: gitleaks v8.30.1 as a sha256-verified pinned binary (checksum in workflow), `gitleaks git` over full history, `--redact=100`. Current tree + history: clean.
- Every Action is pinned to a full commit SHA with a `# vX.Y.Z` comment — never `@main`/`@v4`. Dependabot (`.github/dependabot.yml`) bumps npm (minor+patch grouped, weekly) and github-actions SHAs weekly; nothing auto-merges.
- Lockfile policy (enforced by `test/supply-chain.test.mjs`): all packages must resolve from `registry.npmjs.org` with integrity hashes; `file:`/`git:`/`http:`/`link:` specs are rejected.
- Browser/server env separation (enforced): client source may read only `import.meta.env.{DEV,PROD,MODE,SSR,BASE_URL}` — no custom `VITE_*` variables exist, and server-only names (`SESSION_SECRET`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`, `CRON_SECRET`, `DATABASE_URL`, `VERCEL_TOKEN`, `SECURITY_EVENT_HASH_KEY`) are banned from `src/` + the built artifact, which is also scanned for PEM blocks, GitHub tokens, and JWTs. The deny list derives from `security/secret-inventory.json` — the metadata-only credential inventory (no values). Rotation procedures: `docs/secret-rotation.md`.
- **Revocation:** every issued session carries a random `sid` sealed in the cookie and a row in `auth_sessions`; `requireUser` fails closed without a live sid. `lib/sessions.mjs` — `createAuthSession`, `isSessionLive`, `revokeSession`, `revokeAllSessions`, `gcAuthSessions`. Pre-migration sid-less cookies fail closed (one forced re-login, intentional). `DELETE MY DATA` revokes all sessions before the cascade.
- **Auth gate** (`src/main.tsx`): boot state is `loading → in | out` from `/api/user` only. The Vite dev login bypass is allowed only when `import.meta.env.DEV && !apiPresent` — `apiPresent` is true whenever `/api/user` returns JSON *or* any non-200 response (a crashed function still proves an API exists). Never let the bypass fire under `vercel dev`.
- **Secure flag** follows the effective origin scheme (`appUrl` starts with `https://`), not `NODE_ENV`. Local `VERCEL_URL` hosts (`localhost`, `127.*`, `::1`) get `http://` appUrl — never `https://localhost`.

### Why the lease exists — Firefox Session Restore

A browser-session cookie expires when the *browser's* notion of a session ends — not necessarily when the user closes windows. Firefox deliberately restores session cookies when it restores a browsing session (`browser.startup.page=3`, `browser.sessionstore.resume_session_once`, crash recovery — `SessionCookies.sys.mjs` re-adds them `isSession = true`); a resident Firefox process keeps them too. Verified in production QA: unchecked login survived a full Firefox close + reopen under session restore.

No cookie attribute can force process-exit expiry, and process-exit detection primitives (service-worker epoch, sessionStorage gates, unload hooks, session tables) were evaluated and rejected — none can exactly detect browser exit. The product rule is therefore defined as **inactivity**: "5 minutes with no Dev Ledger contact → sign-in required." The sealed `leaseUntil` enforces it uniformly across browsers — a restored cookie still dies when its lease lapses. Iron-session forces `ttl=0` for session-scoped cookies, which is why the lease lives in the payload, not the seal config.

Accepted trade-offs (intentional): sleep/hibernate or offline > lease → re-login on return; reopening within the lease window after closing stays signed in.

Production acceptance matrix (real OAuth, canonical `https://devledger-app.vercel.app`):

- Default: OAuth → dashboard → refresh ✓ → hard refresh ✓ → new tab ✓ → tab open >5min stays in (heartbeat) · all tabs closed >5min → logged out (any browser, restore or not)
- Remember: same, and restart → still logged in (~30 days, no lease)

## Data layer

`/api/dashboard` is the single read endpoint — all UI data is stored, normalized GitHub-ingested rows scoped by internal user id (tenant isolation; never live GitHub calls, never cross-user data). `src/store/live.ts` fetches it and normalizes into component shapes. Fixtures live under `src/fixtures/` (fictional repos only) and are **dev-only**: the production build aliases the barrel to `src/fixtures/stub.ts` and `live.ts` gates fixture rendering on `import.meta.env.DEV` — a prod API failure resolves to a permanent-resolving empty store (skeletons), never demo telemetry. Sync goes through the shared `/api/sync` pump — no parallel sync implementation; passive `GET /api/sync` polling covers cron/other-tab-driven syncs, and `rate_limited` resumes when `resumeAt` passes.

Repository disconnect: `POST /api/user` `{repositoryId, mode}` — `keep` (stop sync, retain history), `delete` (purge repo-scoped rows for the session user), `resume`. Disconnected repos (`disconnected_at` set) are skipped by discovery/commit/PR/range sync and webhooks; `disconnect_source='github'` auto-reconnects on re-grant, `'user'` stays retained until resume.

Build: hashed multi-file assets (no singlefile) so CSP is `script-src 'self'`; fonts self-hosted via Fontsource (OFL); DB hardening in `migrations/007_security_hardening.sql` (RLS + revokes + security-invoker RPCs + `auth_sessions` + `webhook_deliveries` + `disconnected_at`). Data minimization in `migrations/008_data_minimization.sql`: commit headlines/messages and pull-request titles are not persisted because no product surface uses them.

## Security telemetry

`lib/security-events.mjs` emits one structured JSON line per designated security boundary event (allowlisted `SECURITY_EVENTS`/`SECURITY_SEVERITIES`) to console (Vercel Runtime Logs) and best-effort persists to `security_events` (`migrations/009_security_events.sql`, service_role-only, RLS-closed). Fixed field set only — no IP/UA/cookies/headers/bodies/secrets; actor/source ids are HMAC'd with dedicated `SECURITY_EVENT_HASH_KEY` (never SESSION_SECRET/CRON_SECRET/webhook secrets; unset → hashes null). Telemetry is fail-open: it must never alter the primary response. Retention: 30 days, pruned inside the existing authenticated `/api/cron/sync` run (`pruneSecurityEvents`) — no extra function (project is at the 12-function Hobby cap).
