import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Regression checks for Dev Ledger's public trust boundaries. These are
// source-level controls, NOT a substitute for inspecting the live deployment
// and Google Search Console's security report.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(path.join(root, p), 'utf8')
const config = JSON.parse(read('vercel.json'))

test('external public rewrites have only the two reviewed destinations', () => {
  const external = config.rewrites.filter((r) => /^https?:\/\//i.test(r.destination))
  assert.ok(external.length > 0)
  const allowed = new Set([
    'eu.i.posthog.com',
    'dev-ledger-site.vercel.app',
  ])
  for (const r of external) {
    const target = new URL(r.destination.replace(':path*', 'example'))
    assert.equal(target.protocol, 'https:', 'external rewrite must use HTTPS')
    assert.ok(allowed.has(target.hostname), 'unexpected external rewrite destination')
    assert.equal(target.username, '')
    assert.equal(target.password, '')
    assert.equal(target.port, '')
    assert.equal(target.hash, '')
  }
  const rewriteSources = new Set(config.rewrites.map((r) => r.source))
  assert.equal(rewriteSources.size, config.rewrites.length, 'ambiguous duplicate rewrite sources')
  // Authentication endpoints must remain first-party handlers, not
  // redirects or rewrites into third-party destinations.
  for (const r of config.rewrites) {
    assert.ok(
      !r.source.startsWith('/api/auth/login') &&
      !r.source.startsWith('/api/auth/callback'),
      'GitHub login/callback cannot be rewritten',
    )
  }
})

test('public login remains an explicit GitHub OAuth flow, never a password collector', () => {
  const login = read('src/ledger/LoginScreen.tsx')
  const button = read('src/ledger/shared.tsx')
  const auth = read('api/auth/login.mjs')
  const callback = read('api/auth/callback.mjs')
  assert.doesNotMatch(login, /type\s*=\s*["']password["']/i)
  assert.doesNotMatch(login, /<form\b/i)
  assert.match(login, /Authentication takes place on github\.com/)
  assert.match(login, /Dev Ledger never asks for or receives your GitHub password/)
  assert.match(login, /href="\/privacy"/)
  assert.match(login, /href="\/security"/)
  assert.match(button, /\/api\/auth\/login/)
  assert.match(auth, /https:\/\/github\.com\/login\/oauth\/authorize/)
  assert.match(auth, /url\.searchParams\.set\('state', state\)/)
  assert.match(auth, /await session\.save\(\)/)
  assert.match(callback, /https:\/\/github\.com\/login\/oauth\/access_token/)
  assert.match(callback, /state === session\.oauthState/)
  assert.doesNotMatch(auth + callback, /https?:\/\/(?!github\.com|localhost)/i,
    'OAuth source gained an unexpected absolute origin; review it explicitly')
})

test('public HTML entry points do not import remote script files', () => {
  for (const f of ['index.html', 'privacy.html', 'security.html', 'terms.html']) {
    const html = read(f)
    for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
      const url = match[1]
      assert.ok(url.startsWith('/') && !url.startsWith('//'),
        'unreviewed external executable script in ' + f)
    }
    assert.doesNotMatch(html, /<form[^>]+action=["']https?:\/\//i,
      'unreviewed third-party form destination in ' + f)
    assert.doesNotMatch(html, /javascript:/i,
      'javascript URL in public HTML shell ' + f)
  }
})

test('security headers do not permit embedding or arbitrary form targets', () => {
  const rootHeaders = config.headers.find((h) => h.source === '/(.*)')
  const find = (name) => rootHeaders?.headers.find((x) => x.key === name)?.value
  const csp = find('Content-Security-Policy')
  assert.ok(csp)
  for (const required of [
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]) assert.ok(csp.includes(required), 'missing CSP restriction ' + required)
  assert.equal(find('X-Frame-Options'), 'DENY')
  const auth = config.headers.find((h) => h.source === '/api/auth/(.*)')
  const authTags = auth?.headers.find((h) => h.key === 'X-Robots-Tag')?.value
  assert.match(authTags, /noindex/)
})
