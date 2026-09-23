import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Header identity / account menu / SYS.TIME derivations. Pure-function
// coverage plus source-level guards for the no-DOM test runner.

const {
  initialsFromLogin,
  profileUrl,
  manageReposUrl,
  reconnectUrl,
  isSyncing,
  menuStatus,
} = await import('../src/ledger/accountModel.mjs')
const { formatLocalTime, resolveTimeZone } = await import('../src/ledger/sysTime.mjs')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = (p) => readFileSync(path.join(root, p), 'utf8')

/* ── identity derivations ── */

test('initials derive from the authenticated login', () => {
  assert.equal(initialsFromLogin('noaman'), 'NO')
  assert.equal(initialsFromLogin('@octocat'), 'OC')
  assert.equal(initialsFromLogin('x'), 'X')
  assert.equal(initialsFromLogin(''), '··')
  assert.equal(initialsFromLogin(null), '··')
})

test('profileUrl builds the authenticated user profile — never hardcoded', () => {
  assert.equal(profileUrl('someone-else'), 'https://github.com/someone-else')
  assert.equal(profileUrl('@octocat'), 'https://github.com/octocat')
  assert.equal(profileUrl(''), null)
  assert.equal(profileUrl(null), null)
})

test('manageReposUrl prefers the installation settings URL, falls back to app install', () => {
  assert.equal(
    manageReposUrl({ installations: [{ url: 'https://github.com/settings/installations/123' }] }),
    'https://github.com/settings/installations/123',
  )
  assert.equal(
    manageReposUrl({ installations: [], appSlug: 'dev-ledger' }),
    'https://github.com/apps/dev-ledger/installations/new',
  )
  assert.equal(manageReposUrl({ installations: [], appSlug: null }), null)
})

test('reconnect uses the existing auth flow', () => {
  assert.equal(reconnectUrl(), '/api/auth/login')
})

test('sync status helpers map real backend state', () => {
  assert.equal(isSyncing('syncing'), true)
  assert.equal(isSyncing('idle'), false)
  assert.equal(menuStatus({ status: 'syncing' }), 'GITHUB CONNECTED · SYNCING')
  assert.equal(menuStatus({ status: 'revoked' }), 'GITHUB ACCESS REVOKED')
  assert.equal(menuStatus({ revoked: true }), 'GITHUB ACCESS REVOKED')
  assert.equal(menuStatus({ status: 'idle' }), 'GITHUB CONNECTED')
})

/* ── SYS.TIME ── */

test('formatLocalTime renders local HH:mm:ss', () => {
  const d = new Date(2026, 0, 15, 9, 5, 3) // local components
  const out = formatLocalTime(d)
  assert.match(out, /^\d{2}:\d{2}:\d{2}$/)
  assert.equal(out, `${String(d.getHours()).padStart(2, '0')}:05:03`)
})

test('resolveTimeZone returns the browser/node IANA zone', () => {
  const tz = resolveTimeZone()
  assert.ok(tz.length > 0)
  assert.equal(tz, Intl.DateTimeFormat().resolvedOptions().timeZone)
  assert.match(tz, /\//) // IANA form Continent/City — not an ambiguous abbreviation
})

/* ── source-level guards (no DOM runner) ── */

test('header has no hardcoded @Aliferous3 identity in the account control', () => {
  const header = src('src/components/TerminalTickerHeader.tsx')
  assert.ok(!header.includes("'@Aliferous3'") && !header.includes('"@Aliferous3"'))
  assert.ok(!header.includes('USER.initials') && !header.includes('USER.handle'))
})

test('developer credit still links to github.com/Aliferous3 in a new tab', () => {
  const header = src('src/components/TerminalTickerHeader.tsx')
  assert.ok(header.includes('https://github.com/Aliferous3'))
  const credit = header.match(/<a[\s\S]*?github\.com\/Aliferous3[\s\S]*?<\/a>/)
  assert.ok(credit, 'credit anchor exists')
  assert.ok(credit[0].includes('target="_blank"'))
  assert.ok(credit[0].includes('rel="noopener noreferrer"'))
  assert.ok(credit[0].includes('NOAMAN ALI'))
})

test('SYS.TIME is local browser time — no hardcoded UTC', () => {
  const bar = src('src/components/UtilityBar.tsx')
  assert.ok(!bar.includes('toISOString'), 'no UTC ISO slicing')
  assert.ok(!/>\s*UTC\s*</.test(bar), 'no literal UTC label')
  assert.ok(bar.includes('resolvedOptions().timeZone') || bar.includes('resolveTimeZone'))
})

test('account menu exposes no credentials — presentation fields only', () => {
  const menu = src('src/components/AccountMenu.tsx')
  for (const bad of ['access_token', 'accessToken', 'SESSION_SECRET', 'installation_token', 'password']) {
    assert.ok(!menu.includes(bad), `menu must not reference ${bad}`)
  }
})

test('account menu uses the existing logout and sync paths', () => {
  const menu = src('src/components/AccountMenu.tsx')
  // Logout is POST-only (GET navigation would be cross-site abusable) —
  // the menu issues a same-origin fetch, never an href.
  assert.ok(menu.includes("fetch('/api/auth/logout', { method: 'POST'"), 'sign out posts to the logout route')
  assert.ok(!menu.includes('href="/api/auth/logout"'), 'sign out must not be a GET navigation')
  assert.ok(menu.includes('syncNow'), 'sync action calls the shared store pump')
  assert.ok(!menu.includes('api/sync-range'), 'no parallel range-sync wiring in the menu')
  const store = src('src/store/live.ts')
  assert.ok(store.includes('/api/sync'), 'store pump posts to the existing sync route')
})

test('menu stays inside the established visual language', () => {
  const menu = src('src/components/AccountMenu.tsx')
  assert.ok(menu.includes('bg-[#131413]'))
  assert.ok(menu.includes('role="menu"'))
  assert.ok(menu.includes('aria-haspopup'))
  assert.ok(menu.includes('aria-expanded'))
  for (const bad of ['rounded-lg', 'rounded-xl', 'shadow-lg', 'shadow-2xl', 'backdrop-blur']) {
    assert.ok(!menu.includes(bad), `menu must not use ${bad}`)
  }
})

test('session-persistence work is not regressed', () => {
  const cfg = src('lib/config.mjs')
  assert.ok(cfg.includes('maxAge: undefined'), 'default cookie stays session-scoped')
  const login = src('api/auth/login.mjs')
  assert.ok(login.includes('remember'), 'remember preference still flows')
})
