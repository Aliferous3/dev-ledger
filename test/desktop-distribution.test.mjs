import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalReleaseName, expectedReleaseAssets } from '../scripts/release-assets.mjs'

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
const SHA_OR_PLACEHOLDER = /^([0-9a-f]{64}|\{\{SHA256(_[A-Z0-9_]+)?\}\})$/
const VERSION_OR_PLACEHOLDER = /^([0-9]+\.[0-9]+\.[0-9]+|\{\{VERSION\}\})$/

/* ── Tauri config ───────────────────────────────────────────────────── */

test('tauri.conf.json parses and pins the stable application identity', () => {
  assert.equal(tauriConf.identifier, APP_ID)
  assert.equal(tauriConf.productName, 'Dev Ledger')
  assert.equal(tauriConf.version, pkg.version, 'config version tracks package.json')
})

test('the main window is a normal resizable native window with bounds', () => {
  // The window is created in src-tauri/src/lib.rs (not tauri.conf.json) so
  // the WebviewWindowBuilder can attach the on_navigation origin guard.
  const lib = read('src-tauri/src/lib.rs')
  assert.equal(tauriConf.app.windows.length, 0, 'no config-declared windows')
  assert.match(lib, /WebviewWindowBuilder::new\(app, "main"/)
  assert.match(lib, /\.title\("Dev Ledger"\)/)
  assert.match(lib, /\.resizable\(true\)/)
  const [minW, minH] = /min_inner_size\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\)/
    .exec(lib).slice(1).map(Number)
  const [w, h] = /inner_size\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\)/
    .exec(lib).slice(1).map(Number)
  assert.ok(minW >= 800 && minH >= 500, 'sensible minimums')
  assert.ok(w >= minW && h >= minH)
  assert.match(lib, /\.on_navigation\(is_app_origin\)/)
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

test('lockfiles + visible boot label track package.json', () => {
  const lock = JSON.parse(read('package-lock.json'))
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages[''].version, pkg.version)

  const cargoLock = read('src-tauri/Cargo.lock')
  const cargoVersion =
    /\[\[package\]\]\r?\nname = "dev-ledger"\r?\nversion = "([^"]+)"/.exec(cargoLock)?.[1]
  assert.equal(cargoVersion, pkg.version)

  const escaped = pkg.version.replace(/\./g, '\\.')
  assert.match(read('src/main.tsx'), new RegExp(`label="code metrics · v${escaped}"`))
})

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

test('unreleased manifests carry placeholders or the synced version — never a stale real version', () => {
  // Templates must never point at the already-published v1.3.0 release as
  // though desktop assets existed there. Placeholders ({{VERSION}}/{{TAG}})
  // are the honest state until `npm run desktop:version` stamps a real,
  // NEWER version during release preparation.
  const wingetFiles = [
    'distribution/winget/NoamanAli.DevLedger.yaml',
    'distribution/winget/NoamanAli.DevLedger.installer.yaml',
    'distribution/winget/NoamanAli.DevLedger.locale.en-US.yaml',
  ]
  for (const f of wingetFiles) {
    const v = read(f).match(/^PackageVersion: "?([^"\s]+)"?$/m)[1]
    assert.match(v, VERSION_OR_PLACEHOLDER, f)
    if (v !== '{{VERSION}}') {
      assert.ok(v > '1.3.0', `stamped version must exceed released v1.3.0: ${v} in ${f}`)
    }
  }
  const caskV = read('distribution/homebrew/dev-ledger.rb')
    .match(/^  version "([^"]+)"$/m)[1]
  assert.match(caskV, VERSION_OR_PLACEHOLDER)
  // AppStream release history describes real app releases — it tracks
  // package.json, not a package-manager template placeholder.
  assert.match(read('distribution/flatpak/site.devledger.desktop.metainfo.xml'),
    new RegExp(`<release version="${pkg.version}"`))
})

test('all release URLs are HTTPS, placeholder-tagged, and canonically named', () => {
  const sources = [
    read('distribution/winget/NoamanAli.DevLedger.installer.yaml'),
    read('distribution/homebrew/dev-ledger.rb'),
    read('distribution/flatpak/site.devledger.desktop.yml'),
  ].join('\n')
  const urls = sources.match(/https?:\/\/[^\s"']+/g) || []
  for (const u of urls) {
    assert.ok(u.startsWith('https://'), `non-HTTPS URL: ${u}`)
  }
  const releaseUrls = urls.filter((u) => u.includes('/releases/download/'))
  assert.ok(releaseUrls.length >= 2, 'installer + cask + flatpak URLs present')
  // Tag segment must be a {{TAG}}/v#{version} placeholder or a stamped
  // version that is NEWER than the already-published v1.3.0 — never v1.3.0.
  // Filename skeletons (version+arch stripped) must appear in the shared
  // canonical contract — filename drift between CI and manifests fails here.
  const canonicalSkeletons = new Set(
    Object.values(expectedReleaseAssets('X.Y.Z')).flat().map((n) =>
      n.replace('X.Y.Z', '').replace(/x64|aarch64|amd64/, '')))
  for (const u of releaseUrls) {
    assert.doesNotMatch(u, /download\/v1\.3\.0\//, `must not target released v1.3.0: ${u}`)
    const filename = u.split('/').pop()
    const skeleton = filename
      .replace(/\{\{VERSION\}\}|#\{version\}|[0-9]+\.[0-9]+\.[0-9]+/g, '')
      .replace(/#\{arch\}|x64|aarch64|amd64/g, '')
    assert.ok(canonicalSkeletons.has(skeleton), `non-canonical asset name: ${filename}`)
    const tag = u.match(/download\/([^/]+)\//)[1]
    assert.ok(tag === '{{TAG}}' || tag === 'v#{version}' || /^v\d+\.\d+\.\d+$/.test(tag),
      `unexpected release tag segment: ${tag}`)
  }
})

test('hash fields are placeholders or valid SHA-256 — never anything else', () => {
  const installer = read('distribution/winget/NoamanAli.DevLedger.installer.yaml')
  const sha = installer.match(/InstallerSha256: "?([^"\s]+)"?/)[1]
  assert.match(sha, SHA_OR_PLACEHOLDER)
  const cask = read('distribution/homebrew/dev-ledger.rb')
  const caskShas = [...cask.matchAll(/"([0-9a-f]{64}|\{\{SHA256_[A-Z0-9_]+\}\})"/g)]
  assert.equal(caskShas.length, 2, 'cask carries arm+intel sha256 placeholders')
  const flatpak = read('distribution/flatpak/site.devledger.desktop.yml')
  assert.match(flatpak.match(/sha256: "([^"]+)"/)[1], SHA_OR_PLACEHOLDER)
})

/* ── canonical release-asset filename contract ──────────────────────── */

test('canonicalReleaseName maps every Tauri output to the release contract', () => {
  const v = '9.9.9'
  const cases = {
    [`Dev Ledger_${v}_x64-setup.exe`]: `Dev-Ledger_${v}_x64-setup.exe`,
    [`Dev Ledger_${v}_x64_en-US.msi`]: `Dev-Ledger_${v}_x64_en-US.msi`,
    [`Dev Ledger_${v}_aarch64.dmg`]: `Dev-Ledger_${v}_aarch64.dmg`,
    [`Dev Ledger_${v}_x64.dmg`]: `Dev-Ledger_${v}_x64.dmg`,
    [`Dev Ledger_${v}_amd64.deb`]: `dev-ledger_${v}_amd64.deb`,
    [`Dev Ledger_${v}_amd64.AppImage`]: `Dev-Ledger_${v}_amd64.AppImage`,
  }
  for (const [input, want] of Object.entries(cases)) {
    assert.equal(canonicalReleaseName(input), want, input)
  }
  // Surprises fail loudly — never pass through to a release.
  for (const bad of [
    'dev-ledger_9.9.9_amd64.deb',          // already normalized — wrong prefix
    'Dev Ledger_9.9.9_arm64.deb',          // unproduced arch
    'Dev Ledger_9.9.9_x64-setup.exe.sig',  // updater signature, not an asset
    'Dev Ledger.exe',
    'random.txt',
  ]) {
    assert.equal(canonicalReleaseName(bad), null, bad)
  }
})

test('expectedReleaseAssets enumerates the full release set for a tag', () => {
  const assets = expectedReleaseAssets('1.4.0')
  assert.deepEqual(assets.windows.sort(), [
    'Dev-Ledger_1.4.0_x64-setup.exe', 'Dev-Ledger_1.4.0_x64_en-US.msi',
  ])
  assert.deepEqual(assets['macos-arm64'], ['Dev-Ledger_1.4.0_aarch64.dmg'])
  assert.deepEqual(assets['macos-x64'], ['Dev-Ledger_1.4.0_x64.dmg'])
  assert.deepEqual(assets.linux.sort(), [
    'Dev-Ledger_1.4.0_amd64.AppImage', 'dev-ledger_1.4.0_amd64.deb',
  ])
})

test('the CI collect step normalizes through the shared contract script', () => {
  const wf = read('.github/workflows/desktop.yml')
  assert.match(wf, /node scripts\/release-assets\.mjs dist-artifacts/)
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

/* ── workflow hardening ─────────────────────────────────────────────── */

test('desktop workflow gates the matrix and draft release on quality checks', () => {
  const wf = read('.github/workflows/desktop.yml')
  // Every checkout drops the ambient credential — the release job writes
  // via GH_TOKEN env, not git credentials.
  const checkouts = wf.match(/uses: actions\/checkout@[0-9a-f]+/g) || []
  assert.ok(checkouts.length >= 2, 'checkout used in multiple jobs')
  const persistCount = (wf.match(/persist-credentials: false/g) || []).length
  assert.equal(persistCount, checkouts.length, 'every checkout must unset persist-credentials')
  assert.match(wf, /verify:/, 'quality-gates job exists')
  assert.match(wf, /needs: verify/, 'matrix waits on verification')
  assert.match(wf, /needs: \[verify, build\]/, 'draft release waits on both')
  assert.match(wf, /npm ci --ignore-scripts/)
  assert.doesNotMatch(wf, /npm ci\n/, 'bare npm ci must not survive')
  const verifyBlock = wf.slice(wf.indexOf('  verify:'), wf.indexOf('  build:'))
  for (const gate of ['npm run build', 'npm run typecheck', 'npm test', 'npm audit --audit-level=moderate']) {
    assert.ok(verifyBlock.includes(gate), `verify job runs ${gate}`)
  }
})


test('release tags fail closed on Windows/macOS signing and notarization', () => {
  const wf = read('.github/workflows/desktop.yml')

  // Ordinary CI stays secret-free/unsigned; only tags enter signing paths.
  assert.match(wf, /name: Build unsigned CI bundles/)
  assert.match(wf, /!startsWith\(github\.ref, 'refs\/tags\/v'\)/)

  // Windows: release tags must go through SignPath Foundation using the exact
  // GitHub build artifact, then verify both outer installer signatures and
  // the embedded app binaries after install/extraction.
  for (const required of [
    'SIGNPATH_API_TOKEN',
    'SIGNPATH_ORGANIZATION_ID',
    'SIGNPATH_PROJECT_SLUG',
    'SIGNPATH_SIGNING_POLICY_SLUG',
    'SIGNPATH_APP_ARTIFACT_CONFIGURATION_SLUG',
    'SIGNPATH_INSTALLER_ARTIFACT_CONFIGURATION_SLUG',
    'signpath-unsigned-app.outputs.artifact-id',
    'signpath-unsigned-installers.outputs.artifact-id',
    'npx tauri build --target ${{ matrix.target }} --no-bundle',
    '--no-binary-patching',
    'Ensure bundling preserved the signed Windows executable',
    'signpath/github-action-submit-signing-request@f6d04783b4569d051e0c80105fe66e82819d0092',
    'github-artifact-id',
    'wait-for-completion-timeout-in-seconds: 3600',
    'Get-AuthenticodeSignature',
    'NSIS contains an unsigned or invalid dev-ledger.exe',
    'MSI contains an unsigned or invalid dev-ledger.exe',
  ]) {
    assert.ok(wf.includes(required), `Windows release signing includes ${required}`)
  }
  assert.match(wf, /signature\.Status -ne 'Valid'/)
  assert.doesNotMatch(wf, /SIGNPATH_ARTIFACT_CONFIGURATION_SLUG(?![A-Z_])/, 'legacy one-stage configuration must not remain')

  // macOS: Developer ID + App Store Connect API notarization are mandatory.
  for (const required of [
    'APPLE_CERTIFICATE',
    'APPLE_CERTIFICATE_PASSWORD',
    'APPLE_API_ISSUER',
    'APPLE_API_KEY',
    'APPLE_API_KEY_P8_BASE64',
    'Developer ID Application:',
    'APPLE_SIGNING_IDENTITY',
    'APPLE_API_KEY_PATH',
    'codesign --verify --deep --strict',
    'spctl --assess --type execute',
    'xcrun stapler validate',
  ]) {
    assert.ok(wf.includes(required), `macOS release signing includes ${required}`)
  }

  // A tag draft release can only run after the signed matrix succeeds.
  assert.match(wf, /needs: \[verify, build\]/)
  assert.doesNotMatch(
    wf,
    /Artifacts are unsigned — do not publish before signing\/notarization is configured/,
    'release notes must not describe a signed release pipeline as unsigned',
  )
})

test('SignPath policy is discoverable and truthful before signing approval', () => {
  const policy = read('docs/code-signing-policy.md')
  assert.ok(policy.includes('Free code signing provided by SignPath.io, certificate by SignPath Foundation'))
  assert.ok(policy.includes('not approved or active'), 'no false signing status claim')
  assert.ok(policy.includes('https://devledger.site/privacy'))
  assert.ok(policy.includes('https://github.com/Aliferous3'))
  assert.ok(policy.includes('multi-factor authentication'))
  assert.ok(policy.includes('manually approves each SignPath signing request'))
  for (const file of ['README.md', 'src/ledger/LoginScreen.tsx', 'src/App.tsx']) {
    assert.match(read(file), /code-signing-policy\.md/, `${file} must link to the policy`)
  }
  assert.match(read('.github/workflows/desktop.yml'), /Code signing policy: https:\/\/github\.com\/Aliferous3\/dev-ledger\/blob\/main\/docs\/code-signing-policy\.md/)
})

/* ── flatpak source strategy ────────────────────────────────────────── */

test('flatpak uses a normal pinned file source, never extra-data', () => {
  const manifest = read('distribution/flatpak/site.devledger.desktop.yml')
  assert.doesNotMatch(manifest, /type: extra-data/,
    'extra-data is for non-redistributable binaries — wrong for first-party AGPL')
  assert.match(manifest, /type: file\r?\n[\s\S]*?dest-filename: dev-ledger_amd64\.deb/)
  assert.match(manifest, /only-arches: \[x86_64\]/, 'deb source restricted to produced arch')
  assert.match(read('distribution/flatpak/flathub.json'), /"only-arches": \["x86_64"\]/,
    'flathub.json keeps aarch64 builders from attempting the amd64 deb')
})

/* ── keep-signed-in persistence contract ────────────────────────────── */

test('remember choice survives from login start to token storage', () => {
  const auth = read('src/desktop/auth.ts')
  assert.match(auth, /let pendingRemember/)
  assert.match(auth, /pendingRemember = remember/)
  assert.match(auth, /storeToken\(body\.token, \{ persistent: remember \}\)/)
  const keys = read('src/desktop/keys.ts')
  assert.match(keys, /persistent/, 'storeToken takes a persistence flag')
  // Non-persistent storage MUST clear any stale keychain entry so an old
  // remembered session cannot resurrect after an unchecked login.
  assert.match(keys, /keyring_delete/)
  assert.doesNotMatch(keys, /localStorage\.|sessionStorage\./)
})

/* ── external-link hygiene ──────────────────────────────────────────── */

test('programmatic external navigation routes through the desktop-safe helper', () => {
  const links = read('src/desktop/links.ts')
  assert.match(links, /export function openExternalUrl/)
  // One helper is the only place allowed to open windows/URLs outside the
  // webview — everything else funnels through it.
  const scanned = [
    'src/main.tsx',
    ...readdirSync(path.join(ROOT, 'src/components')).map((f) => `src/components/${f}`),
    ...readdirSync(path.join(ROOT, 'src/ledger')).map((f) => `src/ledger/${f}`),
    ...readdirSync(path.join(ROOT, 'src/desktop')).map((f) => `src/desktop/${f}`),
  ]
  for (const f of scanned) {
    const s = read(f)
    if (f === 'src/desktop/links.ts') continue // the helper itself
    assert.doesNotMatch(s, /window\.open\(/, `${f} must use openExternalUrl`)
    // location assignment is only permitted to internal (root-relative) paths
    const assigns = s.match(/window\.location\.(?:href|assign|replace)\s*=\s*[^;]+|location\.(?:assign|replace)\([^)]*\)/g) || []
    for (const a of assigns) {
      assert.doesNotMatch(a, /https?:\/\//, `${f}: external URL must not navigate the webview — ${a.trim()}`)
    }
  }
  assert.match(read('src/components/SyncMonitor.tsx'), /openExternalUrl/,
    'SyncMonitor GitHub/manage links must use the helper')
})
