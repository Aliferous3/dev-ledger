import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* Desktop transport credential-boundary tests — the desktop bearer may
   ONLY ever ride canonical /api/* targets on the hosted Dev Ledger
   origin.

   Two failure modes are pinned:

   1. /rly/* is the hosted analytics relay: vercel.json rewrites it to
      https://eu.i.posthog.com. A Dev Ledger bearer on that path would
      hand a live credential to a third party. Desktop analytics is
      disabled, so /rly/* has no native transport at all — it passes to
      window.fetch untouched and can never carry the token.

   2. A raw `startsWith('/api/')` check classifies BEFORE URL
      canonicalization — `/api/../rly/e/` and percent-encoded variants
      (`%2e%2e`, `%2E%2E`) normalize to `/rly/e/` on the hosted origin
      and would carry the bearer to a non-API path. resolveApiTarget()
      canonicalizes first and checks the normalized pathname.

   These tests import and run the REAL shim (Node strips the types; the
   Tauri-bound call only executes for /api/* paths, where it rejects in
   Node because no Tauri IPC exists — which itself proves routing). */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(path.join(ROOT, 'src/desktop/transport.ts'), 'utf8')
const API_ORIGIN = 'https://devledger.site'

let transport
let keys
const passedThrough = []

before(async () => {
  // window.fetch capture stub — the shim binds it before wrapping.
  globalThis.window = {
    fetch: async (input, init) => {
      passedThrough.push({ input, init })
      return new Response('{}')
    },
  }
  transport = await import('../src/desktop/transport.ts')
  keys = await import('../src/desktop/keys.ts')
  // Seed a token the way an unchecked ("don't keep me signed in") login
  // does — memory only. The keychain invoke rejects in Node and keys.ts
  // catches it into the documented memory-only fallback.
  await keys.storeToken('dlt_test_boundary_token', { persistent: false })
})

test('root-relative /api/* URLs resolve to the canonical hosted target', () => {
  assert.equal(transport.resolveApiTarget('/api/user'), `${API_ORIGIN}/api/user`)
  assert.equal(transport.resolveApiTarget('/api/sync'), `${API_ORIGIN}/api/sync`)
  assert.equal(
    transport.resolveApiTarget('/api/sync?refresh=1'),
    `${API_ORIGIN}/api/sync?refresh=1`,
  )
  assert.equal(
    transport.resolveApiTarget('/api/auth/desktop?op=logout'),
    `${API_ORIGIN}/api/auth/desktop?op=logout`,
  )
  // Dot segments INSIDE /api/* normalize legitimately — still an API path.
  assert.equal(transport.resolveApiTarget('/api/../api/user'), `${API_ORIGIN}/api/user`)
})

test('dot-segment escapes outside /api/* are rejected — literal and encoded', () => {
  for (const traversal of [
    '/api/../rly/e/',
    '/api/%2e%2e/rly/e/',
    '/api/%2E%2E/rly/e/',
    '/api/%2e./rly/e/',
    '/api/.%2e/rly/e/',
    '/api/../privacy',
    '/api/%2e%2e/',
    '/api/../',
    '/api\\..\\rly\\e\\', // WHATWG treats '\' as '/' on https URLs
  ]) {
    assert.equal(
      transport.resolveApiTarget(traversal),
      null,
      `${traversal} normalizes outside /api/* — must not carry a bearer`,
    )
  }
})

test('/rly/*, absolute, protocol-relative and external URLs are ineligible', () => {
  for (const bad of [
    '/rly/e/',
    '/rly/i/v0/e/',
    '/rly/',
    '/rly/decide/',
    'https://devledger.site/api/user', // absolute — same origin or not
    '//devledger.site/api/user', // protocol-relative — host switch
    'https://eu.i.posthog.com/i/v0/e/',
    'https://evil.example/api/user', // path-shaped suffix is not /api/*
    'evil.example/api/user', // relative — no leading slash
    '/privacy',
    '/',
    'tauri://localhost',
    '',
    'not a url',
  ]) {
    assert.equal(transport.resolveApiTarget(bad), null, `${bad} must NOT qualify`)
  }
})

test('apiHeaders attaches the desktop bearer + hosted Origin to /api/* only', () => {
  const h = transport.apiHeaders({ 'Content-Type': 'application/json' })
  assert.equal(h.Authorization, 'Bearer dlt_test_boundary_token')
  assert.equal(h.Origin, API_ORIGIN)
  assert.equal(h['Content-Type'], 'application/json')
})

test('a caller can never inject its own Authorization through /api/*', () => {
  const h = transport.apiHeaders({ Authorization: 'Bearer smuggled' })
  assert.equal(h.Authorization, 'Bearer dlt_test_boundary_token')
})

test('/rly/*, traversal and external URLs pass to window.fetch untouched', async () => {
  transport.installTransport()

  const callsBefore = passedThrough.length
  for (const url of [
    '/rly/e/',
    '/rly/i/v0/e/',
    '/api/../rly/e/', // resolves to /rly/e/ — non-API after canonicalization
    '/api/%2e%2e/rly/e/',
    'https://evil.example/api/user',
    '/privacy',
  ]) {
    const res = await window.fetch(url, { method: 'POST', body: 'x' })
    assert.equal(res.status, 200)
  }
  assert.equal(passedThrough.length, callsBefore + 6)
  for (const { input, init } of passedThrough.slice(callsBefore)) {
    // The shim must pass the caller's input through verbatim — never a
    // rewritten URL, never added headers.
    assert.equal(typeof input, 'string')
    assert.ok(!input.startsWith(API_ORIGIN), 'not rewritten to the hosted origin')
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('authorization'), null, 'shim added no credential')
    assert.equal(headers.get('origin'), null, 'shim added no hosted Origin')
  }
})

test('/api/* takes the native transport (rejects in Node: no Tauri IPC)', async () => {
  const callsBefore = passedThrough.length
  await assert.rejects(window.fetch('/api/user'), 'native path attempted')
  assert.equal(passedThrough.length, callsBefore, 'did NOT fall back to window.fetch')
})

test('invariant: classification runs on the canonicalized URL, never the raw string', () => {
  const fnSrc = /export function resolveApiTarget[\s\S]*?\n}/.exec(SRC)[0]
  // The canonicalization gate: resolve against API_BASE, then check the
  // NORMALIZED pathname — the raw prefix must never be checked directly.
  assert.match(fnSrc, /new URL\(raw, API_BASE\)/)
  assert.match(fnSrc, /url\.pathname\.startsWith\('\/api\/'\)/)
  assert.doesNotMatch(fnSrc, /raw\.startsWith\('\/api\/'\)/, 'raw prefix check would be pre-canonicalization')
  assert.doesNotMatch(fnSrc, /rly/, 'the analytics relay must never qualify')
})

test('invariant: the validated target is exactly what tauriFetch receives', () => {
  // One binding, one call site: `target` comes out of resolveApiTarget
  // and goes straight into tauriFetch — classification and request can
  // never disagree.
  assert.match(SRC, /const target = resolveApiTarget\(url\)/)
  assert.equal((SRC.match(/tauriFetch\(target/g) || []).length, 1)
  assert.doesNotMatch(SRC, /tauriFetch\(`?\$?\{?API_BASE/, 'no separately reconstructed URL')
})
