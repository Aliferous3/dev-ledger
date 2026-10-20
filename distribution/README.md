# Distribution metadata

Package-manager manifest TEMPLATES for the Dev Ledger desktop app.
Nothing here is submitted anywhere — every file is a preparation
artifact whose `{{VERSION}}` / `{{TAG}}` / `{{DATE}}` / `{{SHA256*}}`
placeholders get filled from a real GitHub Release at release time.

| Directory | Target | Files |
| --- | --- | --- |
| `winget/` | `microsoft/winget-pkgs` (later) | Multi-file manifest set for the NSIS installer |
| `homebrew/` | A `homebrew-*` tap (later) | `dev-ledger.rb` Cask around the `.dmg` assets |
| `flatpak/` | Flathub (later) | Manifest + `flathub.json` + `.desktop` + AppStream metainfo |

## Canonical release-asset names

CI normalizes every copied artifact through
`scripts/release-assets.mjs` — the filenames below are the ONLY names the
manifests may reference (tests enforce this):

| Platform | Canonical filenames |
| --- | --- |
| Windows | `Dev-Ledger_<version>_x64-setup.exe`, `Dev-Ledger_<version>_x64_en-US.msi` |
| macOS | `Dev-Ledger_<version>_aarch64.dmg`, `Dev-Ledger_<version>_x64.dmg` |
| Linux | `dev-ledger_<version>_amd64.deb`, `Dev-Ledger_<version>_amd64.AppImage` |

The installed product is still `Dev Ledger` / `Dev Ledger.app` — only
the release-asset filenames are normalized.

## Per-release update process

0. **Prerequisite:** `migrations/014_desktop_auth.sql` must already be
   applied to the production database — desktop sign-in fails without
   it. Also required BEFORE tagging: bump `package.json` to a **new**
   version (e.g. `1.4.0` — `v1.3.0` is already released and must never
   be reused for desktop assets).
1. Run `npm run desktop:version` — it substitutes the `{{VERSION}}`,
   `{{TAG}}` and `{{DATE}}` placeholders in these manifests and syncs
   `src-tauri/` versions.
2. Tag `v<version>` — the desktop CI's `verify` job runs the full
   quality gates first, then the matrix builds artifacts, then a draft
   release is created with `SHA256SUMS.txt` covering the canonical
   filenames above.
3. Fill every `{{SHA256*}}` placeholder from `SHA256SUMS.txt`.
4. Validate the generated manifests (winget-pkgs validation,
   `brew audit --cask --strict`, `flatpak-builder-lint`).
5. Submit/copy the updated manifests to the package-manager repositories.

See `docs/desktop.md` for the full submission walkthroughs.
