import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* Desktop transport credential-boundary tests — the desktop bearer may
   ONLY ever ride /api/* requests to the hosted Dev Ledger origin.

   /rly/* is the hosted analytics relay: vercel.json rewrites it to
   https://eu.i.posthog.com. A Dev Ledger bearer on that path would hand
   a live credential to a third party. Desktop analytics is disabled, so
   /rly/* has no native transport at all — it passes to window.fetch
   untouched and can never carry the token.

   These tests import and run the REAL shim (Node strips the types; the
   Tauri-bound call only executes for /api/* paths, where it rejects in
   Node because no Tauri IPC exists — which itself proves routing). */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(path.join(ROOT, 'src/desktop/transport.ts'), 'utf8')

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

test('only /api/* qualifies for the bearer-bearing native transport', () => {
  for (const ok of ['/api/user', '/api/sync', '/api/auth/login?x=1', '/api/repos/42']) {
    assert.equal(transport.isApiPath(ok), true, `${ok} must qualify`)
  }
  for (const bad of [
    '/rly/e/',
    '/rly/i/v0/e/',
    '/rly/',
    '/rly/decide/',
    'https://devledger.site/api/user', // absolute URLs never get the shim
    'https://eu.i.posthog.com/i/v0/e/',
    'https://evil.example/api/user', // path-shaped suffix is not /api/*
    '/privacy',
    '/',
    'tauri://localhost',
  ]) {
    assert.equal(transport.isApiPath(bad), false, `${bad} must NOT qualify`)
  }
})

test('apiHeaders attaches the desktop bearer + hosted Origin to /api/* only', () => {
  const h = transport.apiHeaders({ 'Content-Type': 'application/json' })
  assert.equal(h.Authorization, 'Bearer dlt_test_boundary_token')
  assert.equal(h.Origin, 'https://devledger.site')
  assert.equal(h['Content-Type'], 'application/json')
})

test('a caller can never inject its own Authorization through /api/*', () => {
  const h = transport.apiHeaders({ Authorization: 'Bearer smuggled' })
  assert.equal(h.Authorization, 'Bearer dlt_test_boundary_token')
})

test('/rly/* and external URLs pass to window.fetch untouched — no bearer', async () => {
  transport.installTransport()

  const callsBefore = passedThrough.length
  for (const url of [
    '/rly/e/',
    '/rly/i/v0/e/',
    '/rly/decide/',
    'https://evil.example/api/user',
    '/privacy',
  ]) {
    const res = await window.fetch(url, { method: 'POST', body: 'x' })
    assert.equal(res.status, 200)
  }
  assert.equal(passedThrough.length, callsBefore + 5)
  for (const { init } of passedThrough.slice(callsBefore)) {
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

test('invariant: isApiPath can never re-admit the analytics relay', () => {
  const fnSrc = /export function isApiPath[\s\S]*?\n}/.exec(SRC)[0]
  assert.match(fnSrc, /\/api\//)
  assert.doesNotMatch(fnSrc, /rly/, 'the analytics relay must never qualify')
})

test('invariant: a single native-transport call site, inside the /api/* branch', () => {
  // The bearer can only leak through the tauriFetch path — there must be
  // exactly one, and it must sit inside installTransport's api branch.
  assert.equal((SRC.match(/tauriFetch\(/g) || []).length, 1)
  assert.match(SRC, /'Authorization'\] = `Bearer \$\{token\}`/)
})
