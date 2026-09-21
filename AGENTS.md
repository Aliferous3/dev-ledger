# Dev Ledger — agent notes

## Commands

- Test: `npm test` (node:test, no DOM runner — source-level guards where DOM is needed)
- Build: `npm run build` (Vite + vite-plugin-singlefile)
- Preview: `npm run dev` (plain Vite, no API — design/fixture mode) · `vercel dev` (real API routes)

## Session / auth contract

One sealed iron-session cookie `dev_ledger_session` (`lib/config.mjs`, `lib/auth.mjs`):

- **Default (KEEP ME SIGNED IN unchecked):** true browser-session cookie — `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when the effective origin is https, **no Max-Age/Expires** — **plus a server-enforced sliding inactivity lease**: `leaseUntil` (epoch ms) sealed inside the session payload, minted at OAuth callback, renewed by `POST /api/auth/heartbeat` (60s from open tabs) and piggybacked in `getSession` when <50% remains. `SESSION_LEASE_MINUTES` (default **5**, `0` disables) without ANY Dev Ledger contact → expired server-side → login required. This makes "no activity = logged out" uniform across browsers, including Firefox Session Restore (which resurrects session cookies but cannot extend the lease). Sleep/offline > lease → sign-in required on return — intentional.
- **Remember (checked):** identical seal/format + `Max-Age` ~30 days. Only the outgoing persistence attributes differ — `persistent` flag rides inside the sealed cookie through the OAuth round-trip and is honored only after state validation.
- **Logout:** `/api/auth/logout` destroys either variant (`Max-Age=0`).
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

`/api/dashboard` is the single read endpoint — all UI data is stored, normalized GitHub-ingested rows scoped by internal user id (tenant isolation; never live GitHub calls, never cross-user data). `src/store/live.ts` fetches it and normalizes into component shapes; module fixtures are the offline fallback. Sync goes through the shared `/api/sync` pump — no parallel sync implementation; passive `GET /api/sync` polling covers cron/other-tab-driven syncs, and `rate_limited` resumes when `resumeAt` passes.
