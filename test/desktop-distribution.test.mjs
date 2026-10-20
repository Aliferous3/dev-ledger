import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Desktop distribution invariant tests — pure file-level checks, no
// toolchain required. They pin the cross-file contract: one application
// id, one version, HTTPS-only release URLs, least-privilege capabilities,
// and no secret material anywhere in the desktop surface.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel) => existsSync(path.join(ROOT, rel))

const pkg = JSON.parse(read('package.json'))
const tauriConf = JSON.parse(read('src-tauri/tauri.conf.json'))
const capabilities = JSON.parse(read('src-tauri/capabilities/default.json'))

const APP_ID = 'site.devledger.desktop'
const SCHEME = 'dev-ledger'
const ZERO_SHA = '0'.repeat(64)
const SHA_OR_ZERO = /^([0-9a-f]{64})$/

/* ── Tauri config ───────────────────────────────────────────────────── */

test('tauri.conf.json parses and pins the stable application identity', () => {
  assert.equal(tauriConf.identifier, APP_ID)
  assert.equal(tauriConf.productName, 'Dev Ledger')
  assert.equal(tauriConf.version, pkg.version, 'config version tracks package.json')
})

test('the main window is a normal resizable native window with bounds', () => {
  const w = tauriConf.app.windows[0]
  assert.equal(w.title, 'Dev Ledger')
  assert.equal(w.resizable, true)
  assert.ok(w.minWidth >= 800 && w.minHeight >= 500, 'sensible minimums')
  assert.ok(w.width >= w.minWidth && w.height >= w.minHeight)
})

test('deep-link registration uses exactly the dev-ledger scheme', () => {
  const schemes = tauriConf.plugins['deep-link'].desktop.schemes
  assert.deepEqual(schemes, [SCHEME])
  // Frontend + backend agree on the scheme — a mismatch silently breaks login.
  assert.match(read('src/desktop/runtime.ts'), new RegExp(`DESKTOP_SCHEME = '${SCHEME}'`))
  assert.match(read('lib/desktop-auth.mjs'), new RegExp(`DESKTOP_SCHEME = '${SCHEME}'`))
})

test('CSP keeps the web-grade posture: no eval, no remote scripts', () => {
  const csp = tauriConf.app.security.csp
  assert.match(csp, /script-src 'self'/)
  assert.match(csp, /object-src 'none'/)
  assert.match(csp, /base-uri 'self'/)
  assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline.*script|script-src[^;]*https?:/)
})

test('updater is not enabled until real signing infrastructure exists', () => {
  assert.equal(tauriConf.plugins.updater, undefined)
  assert.doesNotMatch(read('src-tauri/Cargo.toml'), /tauri-plugin-updater/)
})

/* ── capabilities: least privilege ──────────────────────────────────── */

test('capabilities grant no filesystem, shell-execution, or clipboard access', () => {
  const perms = capabilities.permissions.map((p) =>
    typeof p === 'string' ? p : p.identifier)
  for (const p of perms) {
    assert.doesNotMatch(p, /^(fs|shell|clipboard|os|dialog|notification|global-shortcut|store|stronghold|sql|websocket|upload|process):/)
  }
  // Deep-link + opener + scoped http + core defaults only.
  assert.deepEqual(perms.sort(), [
    'core:default',
    'core:event:default',
    'deep-link:default',
    'http:default',
    'opener:allow-open-url',
  ])
})

test('http permission scope is limited to the hosted API origin', () => {
  const http = capabilities.permissions.find(
    (p) => typeof p === 'object' && p.identifier === 'http:default')
  assert.ok(http, 'http permission present')
  const urls = http.allow.map((e) => e.url)
  assert.ok(urls.every((u) => u === 'https://devledger.site' || u === 'https://devledger.site/**'),
    `unexpected http scope: ${urls.join(', ')}`)
  assert.equal(http.deny, undefined)
})

test('opener permission can never open executables or local paths', () => {
  const opener = capabilities.permissions.find(
    (p) => typeof p === 'object' && p.identifier === 'opener:allow-open-url')
  assert.ok(opener)
  const urls = opener.allow.map((e) => e.url)
  assert.ok(urls.every((u) => u.startsWith('https://') || u.startsWith('mailto:')))
  // No path-based open permission anywhere.
  const all = JSON.stringify(capabilities)
  assert.doesNotMatch(all, /allow-open-path|allow-reveal-item-in-dir|"path"\s*:/)
})

/* ── Rust crate ─────────────────────────────────────────────────────── */

test('Cargo.toml version tracks package.json and deps stay minimal', () => {
  const cargo = read('src-tauri/Cargo.toml')
  assert.match(cargo, new RegExp(`^version = "${pkg.version.replace(/\./g, '\\.')}"$`, 'm'))
  for (const allowed of [
    'tauri-plugin-opener', 'tauri-plugin-http', 'tauri-plugin-deep-link',
    'tauri-plugin-single-instance', 'keyring', 'serde', 'serde_json', 'tauri',
  ]) {
    assert.match(cargo, new RegExp(`^${allowed} = `, 'm'), `${allowed} present`)
  }
  for (const banned of ['tauri-plugin-fs', 'tauri-plugin-shell', 'tauri-plugin-os',
    'tauri-plugin-clipboard', 'tauri-plugin-global-shortcut']) {
    assert.doesNotMatch(cargo, new RegExp(`^${banned} = `, 'm'), `${banned} must not appear`)
  }
})

test('all required icon formats exist', () => {
  for (const icon of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.png', 'icon.ico', 'icon.icns']) {
    assert.ok(exists(`src-tauri/icons/${icon}`), icon)
    const png = read(`src-tauri/icons/${icon}`)
    assert.ok(png.length > 100, `${icon} is not empty`)
  }
})

/* ── version consistency across distribution metadata ───────────────── */

test('every distribution manifest carries the package.json version', () => {
  const wingetFiles = [
    'distribution/winget/NoamanAli.DevLedger.yaml',
    'distribution/winget/NoamanAli.DevLedger.installer.yaml',
    'distribution/winget/NoamanAli.DevLedger.locale.en-US.yaml',
  ]
  for (const f of wingetFiles) {
    assert.match(read(f), new RegExp(`^PackageVersion: ${pkg.version}$`, 'm'), f)
  }
  assert.match(read('distribution/homebrew/dev-ledger.rb'),
    new RegExp(`^  version "${pkg.version}"`, 'm'))
  assert.match(read('distribution/flatpak/site.devledger.desktop.metainfo.xml'),
    new RegExp(`<release version="${pkg.version}"`))
})

test('all release URLs are HTTPS and point at the GitHub release for this version', () => {
  const sources = [
    read('distribution/winget/NoamanAli.DevLedger.installer.yaml'),
    read('distribution/homebrew/dev-ledger.rb'),
    read('distribution/flatpak/site.devledger.desktop.yml'),
  ].join('\n').replaceAll('#{version}', pkg.version) // Ruby interpolation
  const urls = sources.match(/https?:\/\/[^\s"']+/g) || []
  for (const u of urls) {
    assert.ok(u.startsWith('https://'), `non-HTTPS URL: ${u}`)
  }
  const releaseUrls = urls.filter((u) => u.includes('/releases/download/'))
  assert.ok(releaseUrls.length >= 2, 'installer + cask + flatpak URLs present')
  for (const u of releaseUrls) {
    assert.ok(u.includes(`download/v${pkg.version}/`), `URL must target v${pkg.version}: ${u}`)
  }
})

test('hash fields are either placeholders or valid SHA-256 — never anything else', () => {
  const installer = read('distribution/winget/NoamanAli.DevLedger.installer.yaml')
  const sha = installer.match(/InstallerSha256: ([0-9a-f]+)/)[1]
  assert.match(sha, SHA_OR_ZERO)
  const cask = read('distribution/homebrew/dev-ledger.rb')
  for (const m of cask.matchAll(/"([0-9a-f]{64})"/g)) assert.match(m[1], SHA_OR_ZERO)
  const flatpak = read('distribution/flatpak/site.devledger.desktop.yml')
  assert.match(flatpak.match(/sha256: "([0-9a-f]{64})"/)[1], SHA_OR_ZERO)
})

test('winget manifest names the expected installer type and identifier', () => {
  const installer = read('distribution/winget/NoamanAli.DevLedger.installer.yaml')
  assert.match(installer, /^PackageIdentifier: NoamanAli\.DevLedger$/m)
  assert.match(installer, /^InstallerType: nullsoft$/m)
  assert.match(installer, /_x64-setup\.exe/)
  const locale = read('distribution/winget/NoamanAli.DevLedger.locale.en-US.yaml')
  assert.match(locale, /^Publisher: Noaman Ali$/m)
  assert.match(locale, /^License: AGPL-3\.0-only$/m)
})

test('flatpak manifest + desktop entry + metainfo stay internally consistent', () => {
  const manifest = read('distribution/flatpak/site.devledger.desktop.yml')
  assert.match(manifest, /^id: site\.devledger\.desktop$/m)
  assert.match(manifest, /^command: dev-ledger$/m)
  // Least-privilege finish-args: no filesystem/home/device sockets beyond dri.
  assert.doesNotMatch(manifest, /--filesystem=(home|host)/)
  assert.doesNotMatch(manifest, /--socket=session-bus/)
  assert.doesNotMatch(manifest, /--socket=system/)
  assert.match(manifest, /--share=network/, 'hosted API needs network')

  const desktop = read('distribution/flatpak/site.devledger.desktop.desktop')
  assert.match(desktop, /^Exec=dev-ledger %u$/m)
  assert.match(desktop, /^MimeType=x-scheme-handler\/dev-ledger;$/m)
  assert.match(desktop, /^Icon=site\.devledger\.desktop$/m)

  const metainfo = read('distribution/flatpak/site.devledger.desktop.metainfo.xml')
  assert.match(metainfo, /<id>site\.devledger\.desktop<\/id>/)
  assert.match(metainfo, /desktop-id">site\.devledger\.desktop\.desktop/)
  assert.match(metainfo, /<binary>dev-ledger<\/binary>/)
  assert.ok(exists('distribution/flatpak/site.devledger.desktop.png'), 'icon ships with the manifest')
})

/* ── no secret material in the desktop surface ──────────────────────── */

test('no secret names or values are embedded in desktop source or config', () => {
  const scanned = [
    'src-tauri/tauri.conf.json',
    'src-tauri/Cargo.toml',
    'src-tauri/capabilities/default.json',
    ...readdirSync(path.join(ROOT, 'src/desktop')).map((f) => `src/desktop/${f}`),
  ].map(read).join('\n')
  for (const banned of [
    'SUPABASE_SERVICE_ROLE_KEY', 'SESSION_SECRET', 'GITHUB_CLIENT_SECRET',
    'GITHUB_APP_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET', 'CRON_SECRET',
    'SECURITY_EVENT_HASH_KEY', 'BEGIN PRIVATE KEY', 'BEGIN RSA',
  ]) {
    assert.ok(!scanned.includes(banned), `${banned} must never reach the desktop surface`)
  }
})

test('frontend desktop modules never use localStorage for credentials', () => {
  for (const f of readdirSync(path.join(ROOT, 'src/desktop'))) {
    const s = read(`src/desktop/${f}`)
    if (f === 'shortcuts.ts') continue // zoom preference only — non-secret UI state
    assert.doesNotMatch(s, /localStorage\.|sessionStorage\./, f)
  }
})

test('migration creates the two desktop tables with hash-only storage + RLS', () => {
  const sql = read('migrations/014_desktop_auth.sql')
  assert.match(sql, /create table if not exists public\.desktop_auth_codes/)
  assert.match(sql, /create table if not exists public\.desktop_tokens/)
  assert.match(sql, /code_hash\s+text primary key/)
  assert.match(sql, /token_hash\s+text primary key/)
  assert.match(sql, /enable row level security/)
  // service_role is the only data path; browsers get zero policies.
  assert.match(sql, /revoke all on public\.desktop_auth_codes from public, anon, authenticated/)
  assert.match(sql, /revoke all on public\.desktop_tokens from public, anon, authenticated/)
})
