#!/usr/bin/env node
// Single-source-of-truth version sync for the desktop distribution.
// package.json is authoritative — this script propagates its version to:
//
//   src-tauri/tauri.conf.json                      → bundle metadata
//   src-tauri/Cargo.toml                           → crate version
//   distribution/winget/*.{yaml}                   → PackageVersion + URLs
//   distribution/homebrew/dev-ledger.rb            → cask version
//   distribution/flatpak/*.yml + *.metainfo.xml    → deb URL + <release>
//
// Hashes are NEVER generated here — InstallerSha256 / sha256 / size stay
// placeholder until a real GitHub Release exists (CI SHA256SUMS.txt).
//
// Usage: npm run desktop:version

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const TAG = `v${VERSION}`;

const edits = [];
const upd = (rel, re, repl) => {
  const p = join(ROOT, rel);
  const s = readFileSync(p, 'utf8');
  if (!re.test(s)) throw new Error(`pattern not found in ${rel}`);
  const next = s.replace(re, repl);
  if (next !== s) writeFileSync(p, next);
  edits.push(rel);
};

// --- Tauri config (JSON — parse + stringify, preserving key order) ---------
{
  const p = join(ROOT, 'src-tauri', 'tauri.conf.json');
  const conf = JSON.parse(readFileSync(p, 'utf8'));
  if (conf.version !== VERSION) {
    conf.version = VERSION;
    writeFileSync(p, JSON.stringify(conf, null, 2) + '\n');
  }
  edits.push('src-tauri/tauri.conf.json');
}

// --- Cargo.toml -------------------------------------------------------------
upd('src-tauri/Cargo.toml', /^version = ".*"$/m, `version = "${VERSION}"`);

// --- WinGet -----------------------------------------------------------------
// Templates carry {{VERSION}} / {{TAG}} / {{DATE}} placeholders; stamped
// manifests carry real versions — the patterns below accept both so the
// script is idempotent across release preparations.
const PH_TAG = '(?:\\{\\{TAG\\}\\}|v[0-9]+\\.[0-9]+\\.[0-9]+)';
const PH_VER = '(?:\\{\\{VERSION\\}\\}|[0-9]+\\.[0-9]+\\.[0-9]+)';
for (const f of [
  'distribution/winget/NoamanAli.DevLedger.yaml',
  'distribution/winget/NoamanAli.DevLedger.installer.yaml',
  'distribution/winget/NoamanAli.DevLedger.locale.en-US.yaml',
]) {
  upd(f, /^PackageVersion: .*$/m, `PackageVersion: ${VERSION}`);
}
upd(
  'distribution/winget/NoamanAli.DevLedger.installer.yaml',
  /^ReleaseDate: .*$/m,
  `ReleaseDate: ${new Date().toISOString().slice(0, 10)}`,
);
upd(
  'distribution/winget/NoamanAli.DevLedger.installer.yaml',
  new RegExp(`releases/download/${PH_TAG}/Dev-Ledger_${PH_VER}_x64-setup\\.exe`),
  `releases/download/${TAG}/Dev-Ledger_${VERSION}_x64-setup.exe`,
);

// --- Homebrew Cask ----------------------------------------------------------
upd('distribution/homebrew/dev-ledger.rb', /^  version ".*"$/m, `  version "${VERSION}"`);

// --- Flatpak ----------------------------------------------------------------
upd(
  'distribution/flatpak/site.devledger.desktop.yml',
  new RegExp(`releases/download/${PH_TAG}/dev-ledger_${PH_VER}_amd64\\.deb`),
  `releases/download/${TAG}/dev-ledger_${VERSION}_amd64.deb`,
);
upd(
  'distribution/flatpak/site.devledger.desktop.metainfo.xml',
  /<release version="[^"]*" date="[^"]*"/,
  `<release version="${VERSION}" date="${new Date().toISOString().slice(0, 10)}"`,
);

console.log(`synced version ${VERSION} →`);
for (const e of edits) console.log(`  ${e}`);
console.log('\nReminder: sha256/size placeholders are filled from the GitHub Release SHA256SUMS.txt — never from local builds.');
