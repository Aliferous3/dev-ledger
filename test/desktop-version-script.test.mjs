import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* Behavioral regression tests for scripts/desktop-version.mjs — the
   script runs as a real child process against a temp fixture built from
   the REAL release surfaces, so contract drift in either direction
   fails here.

   Two discovered defects are pinned:

   1. Windows CRLF: Cargo.lock may carry \r\n — the [[package]] entry
      matcher must handle both line endings (it failed with
      "pattern not found in src-tauri/Cargo.lock" on Windows).
   2. Silent ignored version arg: `npm run desktop:version 1.4.1`
      looked like it set the version but only read package.json. Any
      positional argument now exits non-zero with a clear message. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'scripts', 'desktop-version.mjs')

// Every file the script touches — keep in sync with desktop-version.mjs.
const SURFACES = [
  'package.json',
  'package-lock.json',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'src/main.tsx',
  'distribution/winget/NoamanAli.DevLedger.yaml',
  'distribution/winget/NoamanAli.DevLedger.installer.yaml',
  'distribution/winget/NoamanAli.DevLedger.locale.en-US.yaml',
  'distribution/homebrew/dev-ledger.rb',
  'distribution/flatpak/site.devledger.desktop.yml',
  'distribution/flatpak/site.devledger.desktop.metainfo.xml',
]

const FIXTURE_VERSION = '9.9.9'
const tmpDirs = []
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
})

function fixture({ crlfLock = false } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dl-ver-'))
  tmpDirs.push(dir)
  mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  cpSync(SCRIPT, path.join(dir, 'scripts', 'desktop-version.mjs'))
  for (const rel of SURFACES) {
    const dst = path.join(dir, rel)
    mkdirSync(path.dirname(dst), { recursive: true })
    cpSync(path.join(ROOT, rel), dst)
  }
  // Authoritative fixture version — distinct from the real repo so a
  // stale read would produce a visible mismatch, not a silent pass.
  const pkgPath = path.join(dir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.version = FIXTURE_VERSION
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  if (crlfLock) {
    const lockPath = path.join(dir, 'src-tauri', 'Cargo.lock')
    const lf = readFileSync(lockPath, 'utf8').replace(/\r\n/g, '\n')
    writeFileSync(lockPath, lf.replace(/\n/g, '\r\n'))
  }
  return dir
}

const run = (dir, args = []) =>
  spawnSync(process.execPath, [path.join(dir, 'scripts', 'desktop-version.mjs'), ...args], {
    cwd: dir,
    encoding: 'utf8',
  })

const cargoLockEntry = (dir) =>
  /\[\[package\]\]\r?\nname = "dev-ledger"\r?\nversion = "([^"]+)"/.exec(
    readFileSync(path.join(dir, 'src-tauri', 'Cargo.lock'), 'utf8'),
  )?.[1]

test('sync writes the package.json version into an LF Cargo.lock', () => {
  const dir = fixture()
  const r = run(dir)
  assert.equal(r.status, 0, `stderr: ${r.stderr}`)
  assert.equal(cargoLockEntry(dir), FIXTURE_VERSION)
  // End-to-end sanity: another JSON surface synced too.
  const conf = JSON.parse(readFileSync(path.join(dir, 'src-tauri', 'tauri.conf.json'), 'utf8'))
  assert.equal(conf.version, FIXTURE_VERSION)
})

test('sync accepts a CRLF Cargo.lock (Windows checkout)', () => {
  const dir = fixture({ crlfLock: true })
  const r = run(dir)
  assert.equal(r.status, 0, `stderr: ${r.stderr}`)
  assert.equal(cargoLockEntry(dir), FIXTURE_VERSION)
})

test('a positional version argument is rejected, not silently ignored', () => {
  const dir = fixture()
  const before = readFileSync(path.join(dir, 'package.json'), 'utf8')
  const r = run(dir, ['1.4.1'])
  assert.notEqual(r.status, 0, 'must exit non-zero')
  assert.match(r.stderr + r.stdout, /package\.json/)
  // Nothing was touched — the rejection happens before any writes.
  assert.equal(readFileSync(path.join(dir, 'package.json'), 'utf8'), before)
})
