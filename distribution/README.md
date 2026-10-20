# Distribution metadata

Package-manager manifests for the Dev Ledger desktop app. Nothing here is
submitted anywhere — every file is a preparation artifact whose
`version`/`sha256` placeholders get filled from a real GitHub Release.

| Directory | Target | Files |
| --- | --- | --- |
| `winget/` | `microsoft/winget-pkgs` (later) | Multi-file manifest set for the NSIS installer |
| `homebrew/` | A `homebrew-*` tap (later) | `dev-ledger.rb` Cask around the `.dmg` assets |
| `flatpak/` | Flathub (later) | Manifest + `.desktop` + AppStream metainfo |

## Per-release update process

1. Bump `package.json` version, then run `npm run desktop:version` — it
   syncs the version into `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml`, these manifests, and the AppStream release entry.
2. Tag `v<version>` — the desktop CI builds artifacts and a draft release
   with `SHA256SUMS.txt`.
3. Fill every `sha256`/`InstallerSha256`/`size` placeholder from
   `SHA256SUMS.txt` (all-zero placeholders mean "not releasable yet" —
   tests enforce this rule).
4. Submit/copy the updated manifests to the package-manager repositories.

See `docs/desktop.md` for the full submission walkthroughs.
