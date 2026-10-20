#!/usr/bin/env node
// Canonical release-asset filename contract — THE single source of truth.
//
// Tauri emits bundle filenames derived from productName:
//
//   Windows: "Dev Ledger_<version>_x64-setup.exe"
//            "Dev Ledger_<version>_x64_en-US.msi"
//   macOS:   "Dev Ledger_<version>_aarch64.dmg" / "_x64.dmg"
//   Linux:   "Dev Ledger_<version>_amd64.deb"
//            "Dev Ledger_<version>_amd64.AppImage"
//
// Package managers (WinGet, Homebrew, Flathub) point at normalized names.
// This module maps Tauri output → canonical release asset; CI calls
// `node scripts/release-assets.mjs <dir>` to rename collected artifacts,
// and tests import canonicalReleaseName() to keep the contract closed.
//
// The product/install name stays "Dev Ledger" — only the COPIED release
// asset filenames are normalized (spaces → hyphen; the Debian package
// keeps the lowercase deb naming convention).

export const PRODUCT_SOURCE_PREFIX = 'Dev Ledger_';

// Canonical product tokens per artifact kind. Debian packages follow the
// deb package-name convention (lowercase); everything else uses the
// hyphenated product name.
const DEB_PREFIX = 'dev-ledger_';
const ASSET_PREFIX = 'Dev-Ledger_';

export function canonicalReleaseName(base) {
  if (!base.startsWith(PRODUCT_SOURCE_PREFIX)) return null;
  const tail = base.slice(PRODUCT_SOURCE_PREFIX.length);
  // Reject anything that isn't a <version>_<arch>[-variant].<ext> bundle
  // filename — a surprise name must fail loudly, never drift silently.
  if (!/^\d+\.\d+\.\d+_(x64|aarch64|amd64)([-_][\w-]+)?\.(exe|msi|dmg|deb|AppImage)$/.test(tail)) {
    return null;
  }
  return (base.endsWith('.deb') ? DEB_PREFIX : ASSET_PREFIX) + tail;
}

// The complete expected asset set for a release tag — used by tests to
// keep manifest URLs and CI output in lockstep.
export function expectedReleaseAssets(version) {
  const v = version;
  return {
    windows: [`Dev-Ledger_${v}_x64-setup.exe`, `Dev-Ledger_${v}_x64_en-US.msi`],
    'macos-arm64': [`Dev-Ledger_${v}_aarch64.dmg`],
    'macos-x64': [`Dev-Ledger_${v}_x64.dmg`],
    linux: [`dev-ledger_${v}_amd64.deb`, `Dev-Ledger_${v}_amd64.AppImage`],
  };
}

// --- CLI: rename every collected artifact in <dir> to canonical names ---
if (process.argv[1]?.endsWith('release-assets.mjs')) {
  const { readdirSync, renameSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node scripts/release-assets.mjs <artifact-dir>');
    process.exit(2);
  }
  const out = [];
  for (const base of readdirSync(dir)) {
    const canon = canonicalReleaseName(base);
    if (!canon) {
      console.error(`release-assets: unexpected bundle filename: ${base}`);
      process.exit(1);
    }
    renameSync(join(dir, base), join(dir, canon));
    out.push(canon);
  }
  out.sort();
  console.log('canonical release assets:');
  for (const n of out) console.log(`  ${n}`);
}
