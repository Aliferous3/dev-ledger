# Dev Ledger — agent notes

## Commands

- Test: `npm test` (node:test, no DOM runner — source-level guards where DOM is needed)
- Build: `npm run build` (Vite + vite-plugin-singlefile)
- Preview: `npm run dev` (plain Vite, no API — design/fixture mode) · `vercel dev` (real API routes)

## Session / auth contract

One sealed iron-session cookie `dev_ledger_session` (`lib/config.mjs`, `lib/auth.mjs`):

- **Default (KEEP ME SIGNED IN unchecked):** true browser-session cookie — `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when the effective origin is https, **no Max-Age/Expires**. Survives refresh / hard refresh / navigation / new tabs; dies with the browser session.
- **Remember (checked):** identical seal/format + `Max-Age` ~30 days. Only the outgoing persistence attributes differ — `persistent` flag rides inside the sealed cookie through the OAuth round-trip and is honored only after state validation.
- **Logout:** `/api/auth/logout` destroys either variant (`Max-Age=0`).
- **Auth gate** (`src/main.tsx`): boot state is `loading → in | out` from `/api/user` only. The Vite dev login bypass is allowed only when `import.meta.env.DEV && !apiPresent` — `apiPresent` is true whenever `/api/user` returns JSON *or* any non-200 response (a crashed function still proves an API exists). Never let the bypass fire under `vercel dev`.
- **Secure flag** follows the effective origin scheme (`appUrl` starts with `https://`), not `NODE_ENV`. Local `VERCEL_URL` hosts (`localhost`, `127.*`, `::1`) get `http://` appUrl — never `https://localhost`.

### Known caveat — Firefox Session Restore (accepted, do not "fix")

A browser-session cookie expires when the *browser's* notion of a session ends — not necessarily when the user closes windows. Firefox deliberately restores session cookies when it restores a browsing session (`browser.startup.page=3` "Open previous windows and tabs", `browser.sessionstore.resume_session_once`, crash recovery — see `SessionCookies.sys.mjs`, which re-adds them `isSession = true`). A resident Firefox process also keeps them. Verified in production QA: unchecked login survived a full Firefox close + reopen under session restore.

This is standards-compliant. No cookie attribute can force process-exit expiry, and every alternative was investigated and **rejected**: service-worker epoch binding, sessionStorage gates, unload/pagehide hooks, server-side sliding leases/heartbeats, and session tables. None can exactly detect browser-process exit (no origin-scoped primitive shares the process lifetime), and leases/heartbeats cause false logouts after sleep, tab discard, or background suspension. Do not add them — the current implementation is final.

Production acceptance matrix (real OAuth, canonical `https://devledger-app.vercel.app`):

- Default: OAuth → dashboard → refresh ✓ → hard refresh ✓ → new tab ✓ → browser restart → logged out *unless the browser restores session cookies (Firefox restore/resident process)*
- Remember: same, and restart → still logged in

## Data layer

`/api/dashboard` is the single read endpoint — all UI data is stored, normalized GitHub-ingested rows scoped by internal user id (tenant isolation; never live GitHub calls, never cross-user data). `src/store/live.ts` fetches it and normalizes into component shapes; module fixtures are the offline fallback. Sync goes through the shared `/api/sync` pump — no parallel sync implementation; passive `GET /api/sync` polling covers cron/other-tab-driven syncs, and `rate_limited` resumes when `resumeAt` passes.
