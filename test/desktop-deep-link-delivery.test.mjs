import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Tauri 2 Windows/Linux deep links launch a second process. The original
// instance must intercept it BEFORE any plugin setup or window creation.
// Docs: https://v2.tauri.app/plugin/deep-linking/#desktop
const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

test('single-instance enables Tauri deep-link forwarding explicitly', () => {
  const cargo = src('src-tauri/Cargo.toml')
  assert.match(cargo, /tauri-plugin-single-instance\s*=\s*\{[^\n]*features\s*=\s*\["deep-link"\]/)
  assert.match(cargo, /tauri-plugin-deep-link\s*=/)
})

test('single-instance initializes first, not inside setup, so Windows forwards the URI', () => {
  const rust = src('src-tauri/src/lib.rs')
  const first = rust.indexOf('builder.plugin(tauri_plugin_single_instance::init(')
  const opener = rust.indexOf('.plugin(tauri_plugin_opener::init())')
  const deepLink = rust.indexOf('.plugin(tauri_plugin_deep_link::init())')
  const setup = rust.indexOf('.setup(|app|')
  assert.ok(first >= 0 && opener >= 0 && deepLink >= 0 && setup >= 0)
  assert.ok(first < opener && opener < deepLink && deepLink < setup,
    'single-instance must precede all other plugins and setup')
  assert.doesNotMatch(rust.slice(setup), /app\.handle\(\)\s*\.plugin\(tauri_plugin_single_instance/)
  assert.match(rust, /app\.deep_link\(\)\.register\("dev-ledger"\)/)
  assert.match(rust, /get_webview_window\("main"\)/)
})

test('desktop login consumes deep links only after binding them to the pending flow', () => {
  const ts = src('src/desktop/auth.ts')
  assert.ok(ts.includes("import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'"))
  assert.ok(ts.includes('await onOpenUrl((urls) =>'))
  assert.ok(ts.includes('const current = await getCurrent()'))
  assert.ok(ts.includes('flow !== pendingFlow'))
  assert.ok(ts.includes('!pendingVerifier'))
  assert.ok(ts.includes("fetch('/api/auth/desktop?op=exchange'"))
  assert.ok(ts.includes('body: JSON.stringify({ flow, code, verifier })'))
})

test('JS receives diagnostic protocol activations without an OAuth exchange', () => {
  const ts = src('src/desktop/auth.ts')
  assert.match(ts, /parsed\.hostname === 'diagnostic'/)
  assert.ok(ts.includes('Windows protocol link reached the Dev Ledger JavaScript listener.'))
  assert.match(ts, /if \(isDiagnosticLink\(u\)\)/)
  assert.match(ts, /if \(isAuthDeepLink\(u\)\) void handleAuthUrl\(u\)/)
})

test('auth URLs report mismatched and malformed returns without exposing code or state', () => {
  const ts = src('src/desktop/auth.ts')
  assert.match(ts, /parsed\.hostname === 'auth'/)
  assert.match(ts, /parsed\.searchParams\.getAll\('flow'\)/)
  assert.match(ts, /parsed\.searchParams\.getAll\('code'\)/)
  assert.match(ts, /if \(!pendingFlow \|\| flow !== pendingFlow \|\| !pendingVerifier\)/)
  assert.ok(ts.includes('A sign-in link reached Dev Ledger, but does not match an active login.'))
  assert.match(ts, /if \(exchangeInProgress\) return/)
  assert.match(ts, /exchangeInProgress = true/)
  assert.match(ts, /exchangeInProgress = false/)
  assert.match(ts, /cb\(lastNotice\)/, 'late React subscribers must receive the last safe notice')
  assert.doesNotMatch(ts, /console\.(log|warn|error)\(/, 'desktop auth must not emit credential-bearing console logs')
})
