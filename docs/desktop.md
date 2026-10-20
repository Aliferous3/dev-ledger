# Dev Ledger Desktop

Native desktop distribution of Dev Ledger for Windows, macOS and Linux —
a [Tauri 2](https://v2.tauri.app) shell around the **same** React + Vite
frontend that powers <https://devledger.site>. The hosted web app remains
the canonical deployment; the desktop app reuses it architecturally and
never replaces it.

- Product name: **Dev Ledger**
- Application ID: **`site.devledger.desktop`**
- Executable / package name: **`dev-ledger`**
- Deep-link scheme: **`dev-ledger://`**

## Architecture

```
┌──────────────────────────────┐        ┌─────────────────────────────┐
│  Dev Ledger desktop (Tauri)  │        │  devledger.site (Vercel)    │
│                              │        │                             │
│  webview: bundled dist/      │ HTTPS  │  api/* — unchanged server   │
│  src/desktop/transport.ts ───┼───────▶│  surface. Bearer tokens     │
│  (tauri-plugin-http, Rust)   │ Bearer │  accepted alongside the     │
│                              │ token  │  sealed session cookie.     │
│  OS keychain (Rust keyring)  │        │                             │
│  dev-ledger:// deep link ◀───┼────────│  system-browser OAuth       │
│                              │  hand  │  hands off a 1-time code    │
└──────────────────────────────┘        └─────────────────────────────┘
```

- **Frontend**: the exact `dist/` output of `npm run build` — same HTML,
  same components, same API call sites. Nothing forks the UI.
- **API transport**: `src/desktop/transport.ts` shims `window.fetch` so
  `/api/*` requests go through `tauri-plugin-http` (Rust reqwest) to
  `https://devledger.site`, carrying `Authorization: Bearer <token>` and
  `Origin: https://devledger.site`. Because requests happen in Rust, the
  webview never participates in CORS and the server keeps its strict
  browser-only origin posture.
- **State**: when "keep me signed in" is checked the bearer token lives
  in the OS credential store (Windows Credential Manager, macOS Keychain,
  Linux Secret Service) via the Rust `keyring` crate — never in
  localStorage or files. Unchecked logins keep the token in process
  memory for the running session only; the same memory-only fallback
  applies when no keychain daemon is reachable.
- **Native glue**: `tauri-plugin-opener` sends every external link to the
  system browser; `tauri-plugin-deep-link` receives `dev-ledger://`
  handoffs; `tauri-plugin-single-instance` keeps one window. Capabilities
  grant exactly those plugins plus HTTP-scoped-to-devledger.site — no fs,
  no shell, no clipboard.

## Authentication flow

The desktop app never renders a GitHub credential form and never sees an
OAuth code or session cookie:

1. Sign in → `GET {API}/api/auth/login?desktop_flow=<uuid>` opens in the
   **system browser** (the flow id is a random UUID minted in-app).
2. The existing GitHub OAuth → `/api/auth/callback` → optional GitHub App
   install → `/api/setup` chain runs unchanged in the browser.
3. The final redirect goes to `dev-ledger://auth?flow=<uuid>&code=<dlc_…>`
   instead of `/`. Only a **single-use handoff code** (2-minute TTL,
   stored hashed) travels — never a session id or token.
4. The deep link wakes the app; `flow` must equal the UUID it minted in
   step 1 (deep links from other sources are dropped).
5. `POST /api/auth/desktop?op=exchange` (rewritten to
   `/api/user?action=desktop` to keep the serverless function count) with
   `{flow, code, verifier}` consumes the code atomically, verifies the
   PKCE-style challenge, and returns an opaque `dlt_…` bearer token
   (stored hashed server-side, plaintext shown once). The token is bound
   to a dedicated server-side `auth_sessions` row — logout, account
   deletion and kill-all sessions revoke it through the same machinery
   as browser sessions.

### KEEP ME SIGNED IN on desktop

The login checkbox is honored locally — server-side expiry and
revocation are identical either way:

- **Unchecked**: the exchanged token is kept in process memory only and
  any previous keychain credential is deleted. The session works for the
  running app; after the app closes, sign-in is required again. (This is
  a desktop persistence choice — not a browser-cookie lifetime.)
- **Checked**: the token is written to the OS keychain and restored on
  the next launch, subject to the usual server-side expiry/revocation.

Credentials never touch localStorage/sessionStorage in either mode.

No embedded webview login: GitHub OAuth happens in the user's real
browser with full passkey/2FA support, and the app never touches the
credential material.

### Manual configuration required

**GitHub App / OAuth callback**: none. The OAuth redirect stays
`https://devledger.site/api/auth/callback`; the deep link happens *after*
the callback, so no custom-scheme redirect URI needs registering with
GitHub.

**Supabase**: no Auth redirect URLs — Supabase Auth is not used;
authentication is the app's own iron-session/bearer system.

**Database — release prerequisite**: desktop authentication cannot work
in production until migration `014_desktop_auth.sql`
(`desktop_auth_codes` + `desktop_tokens` tables) has been applied
successfully to the production database via the normal migration path.
Do this BEFORE publishing a desktop release — the app has no fallback.

### Why bearer instead of cookies

Webview cookie storage against `tauri://` cannot carry the hosted
`devledger.site` session — cross-site cookies and SameSite rules apply
inside webviews too. A revocable opaque token in the OS keychain is the
established pattern (GitHub Desktop, VS Code use equivalents) and gives
per-device revocation "Delete my data" already provides.

## Local development

Prerequisites: Node 24, Rust stable, and the platform toolchain
(Windows: MSVC build tools; macOS: Xcode CLT; Linux: webkit2gtk-4.1 dev
packages — the CI workflow lists them).

```bash
npm ci
npm run dev            # web-only Vite dev server (browser)

npm run desktop:dev    # tauri dev — hot-reloads the frontend in the shell
npm run desktop:build  # tauri build — production bundles for this OS
npm run desktop:icon   # regenerate icon-src + all platform icon formats
npm run desktop:version# sync package.json version into Tauri/manifests
```

To develop against a local API, set `VITE_DESKTOP_API_BASE` (see
`.env.example`) — production builds must leave it unset so the transport
targets `https://devledger.site`.

## Build outputs

`npm run desktop:build` (or CI) writes bundles under
`src-tauri/target/**/release/bundle/`. Tauri names them with the product
name (`Dev Ledger_…`); CI's collect step renames every copied artifact
through `scripts/release-assets.mjs` into the **canonical release-asset
contract** — the only names package manifests may reference:

| Platform | Bundles | Canonical release filenames |
| --- | --- | --- |
| Windows | NSIS `.exe`, MSI | `Dev-Ledger_<version>_x64-setup.exe`, `Dev-Ledger_<version>_x64_en-US.msi` |
| macOS | `.app`, `.dmg` | `Dev-Ledger_<version>_aarch64.dmg`, `Dev-Ledger_<version>_x64.dmg` |
| Linux | `.deb`, AppImage | `dev-ledger_<version>_amd64.deb`, `Dev-Ledger_<version>_amd64.AppImage` |

The contract is enforced by tests — a drift between CI output and
manifest URLs fails `desktop-distribution.test.mjs`.

macOS x64 builds cross-compile from the arm64 runner via
`--target x86_64-apple-darwin` (the `macos-13` Intel runner is retired).

## CI / release flow

`.github/workflows/desktop.yml`:

- Every job checks out with `persist-credentials: false` and installs
  with `npm ci --ignore-scripts`.
- A `verify` job (build + typecheck + test + audit) runs **first**;
  the desktop matrix `needs` it, and the draft-release job needs both.
- **PRs / main / manual**: build matrix (windows x64, macOS arm64, macOS
  x64, linux x64) → uploads `desktop-<label>` artifacts. No secrets used.
- **Tag `v*`**: same gated matrix, then a `release` job downloads every
  artifact, generates `SHA256SUMS.txt` over the canonical filenames, and
  creates a **draft** GitHub Release — a human reviews and publishes;
  nothing auto-publishes. Release tags also run the security workflow's
  full-history gitleaks scan.

Version flow — **the first desktop release must bump `package.json` to a
version that has never been released** (e.g. `1.4.0`: `v1.3.0` is already
the first public GitHub Release and has no desktop assets). Then run
`npm run desktop:version` (substitutes the `{{VERSION}}`/`{{TAG}}`/
`{{DATE}}` manifest placeholders), tag `v<same version>`.

## Signing & notarization

**Current status: unsigned.** Artifacts run fine for testing; Windows
SmartScreen and Gatekeeper will warn. Activation when ready:

- **Windows (Authenticode)**: export a code-signing cert and use
  `signCommand`/`signCommandArgs` under `bundle.windows`, or an external
  signer (signtool / Azure Trusted Signing). Secret names to provision:
  none currently — decide between cert-in-CI vs Trusted Signing service.
- **macOS**: `APPLE_CERTIFICATE` (Developer ID Application),
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
  plus notarization creds `APPLE_ID`/`APPLE_PASSWORD` (app-specific) or
  `APPLE_API_KEY`/`APPLE_API_ISSUER`/`APPLE_API_KEY_PATH`.
- **Linux**: no signing requirement; AppImage/deb integrity is covered by
  `SHA256SUMS.txt`.
- **Tauri updater** (future): `TAURI_SIGNING_PRIVATE_KEY` +
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — generate with
  `npx tauri signer generate`. The updater is intentionally NOT
  configured yet (see below).

## Auto-updater

Not enabled. `tauri-plugin-updater` requires a signing keypair
(`TAURI_SIGNING_PRIVATE_KEY`) to sign update artifacts — without it the
plugin cannot be enabled honestly. To activate later:

1. `npx tauri signer generate -w ~/.tauri/dev-ledger.key`
2. Add `plugins.updater` config to `tauri.conf.json` with the pubkey +
   `latest.json` endpoint (GitHub Releases static endpoint works).
3. Add `tauri-plugin-updater` to `Cargo.toml` + `@tauri-apps/plugin-updater`
   to `package.json`, add `updater:default` to capabilities.
4. Store the private key as the `TAURI_SIGNING_PRIVATE_KEY` CI secret.

## Package managers

### WinGet (`distribution/winget/`)

Multi-file manifest for `NoamanAli.DevLedger`, installer type `nullsoft`
(NSIS). After a release: fill `InstallerSha256` from `SHA256SUMS.txt`,
validate with `winget validate --manifest distribution/winget`, then copy
to a `winget-pkgs` fork under
`manifests/n/NoamanAli/DevLedger/<version>/` and PR it.

### Homebrew Cask (`distribution/homebrew/dev-ledger.rb`)

Cask over both `.dmg` assets (`arch arm/intel`). Fill `sha256` from
`SHA256SUMS.txt`, check with `brew audit --cask --strict dev-ledger.rb`,
and publish to a `homebrew-tap` repo (casks for self-published apps live
in the author's tap rather than homebrew-core).

### Flatpak / Flathub (`distribution/flatpak/`)

Manifest repackages our first-party release `.deb` as a normal pinned
`type: file` source — not `extra-data`, which exists for proprietary
non-redistributable binaries fetched on the user's machine. Dev Ledger
is AGPL-3.0 software built by this repo's CI, so flatpak-builder fetches
the deb (URL + sha256 pinned) and `build-commands` unpack it inside the
sandbox. `flathub.json` restricts to `x86_64` — the only deb produced
today. Fill `sha256` from `SHA256SUMS.txt`, then validate:

```bash
flatpak-builder --repo=repo build distribution/flatpak/site.devledger.desktop.yml
flatpak run org.flathub.flatpak-builder-lint manifest distribution/flatpak/site.devledger.desktop.yml
appstreamcli validate distribution/flatpak/site.devledger.desktop.metainfo.xml
```

If Flathub reviewers require a source build instead of the upstream deb,
switch the module to build with `org.gnome.Sdk` + `org.freedesktop.Sdk.Extension.node24`
+ `org.freedesktop.Sdk.Extension.rust-stable` using `flatpak-node-generator`
(npm lockfile → sources) and `cargo vendor` output — that path is heavier
and only worth it if review demands it.

## Security notes

- **Capabilities** (`src-tauri/capabilities/default.json`): `core`,
  `deep-link`, `opener` (https/mailto only, system browser), `http`
  (scoped to `https://devledger.site` only). No fs/shell/clipboard/os.
- **CSP**: bundled `default-src 'self'` + IPC origins; images limited to
  bundled assets + GitHub avatars; no external scripts ever.
- **Navigation**: Rust `on_navigation` restricts the webview to the app
  origin (`tauri://` / `tauri.localhost` / dev `localhost`) — remote
  navigation is impossible; external links go through opener validation.
- **Deep links**: only `dev-ledger://auth?flow=<uuid>&code=…` is
  honored; the flow UUID must match an in-flight login, and codes are
  single-use + hashed server-side.
- **Tokens**: opaque, hashed server-side, bound to a revocable
  `auth_sessions` row, stored in the OS keychain when "keep me signed in"
  is checked (process memory only otherwise), never in JS storage.
- **Analytics**: the desktop build initializes neither PostHog, GA4, nor
  Vercel Analytics — those systems are web-deployment plumbing and the
  `tauri://` origin satisfies none of their production gates.
- **Secrets**: nothing beyond public `VITE_*` config reaches the bundle;
  server credentials remain Vercel-side only.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Login opens browser, app never wakes | `dev-ledger://` scheme not registered — reinstall via installer (dev: `tauri dev` registers on Win/Linux; macOS needs a built `.app`). |
| "handoff failed or expired" | Code older than 2 min or already used — sign in again. |
| Stuck at login after exchange | Token rejected — check `desktop_tokens` row exists / session revoked; sign out + in. |
| Linux: `webkit2gtk` errors | Install `libwebkit2gtk-4.1-dev`; Flatpak uses GNOME runtime instead. |
| Linux: login token lost at restart | No Secret Service daemon (headless) — token degrades to memory by design. |
| Window renders blank in dev | Vite dev server not on 5173 — `devUrl` in `tauri.conf.json` expects the default. |
