import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { getIronSession } from 'iron-session'
import { cookie as sessionCookie, sessionLeaseMs, appUrl } from '../lib/config.mjs'
import { getSession } from '../lib/auth.mjs'
import loginHandler from '../api/auth/login.mjs'
import callbackHandler from '../api/auth/callback.mjs'
import heartbeatHandler from '../api/auth/heartbeat.mjs'
import userHandler from '../api/user.mjs'
import logoutHandler from '../api/auth/logout.mjs'

// Server-enforced sliding inactivity lease: non-persistent sessions carry a
// sealed `leaseUntil`; it slides on activity/heartbeat and expires the
// session server-side after SESSION_LEASE_MINUTES without contact —
// independent of browser cookie/session-restore behavior.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = (p) => readFileSync(path.join(root, p), 'utf8')

const MIN = 60_000
assert.ok(sessionLeaseMs > 0 && sessionLeaseMs <= 30 * MIN, 'lease must be a sane positive duration')
const ORIGIN = new URL(appUrl).origin

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    _headers: {},
    status(code) { this.statusCode = code; return this },
    json(b) { this.body = b; return this },
    setHeader(k, v) { this._headers[k.toLowerCase()] = v },
    getHeader(k) { return this._headers[k.toLowerCase()] },
    getHeaders() { return this._headers },
    writeHead(code, h) { this.statusCode = code; if (h) for (const [k, v] of Object.entries(h)) this._headers[k.toLowerCase()] = v; return this },
    end() { return this },
  }
}

function mockReq(overrides = {}) {
  // Handlers read query via requestQuery(req) (WHATWG URL over req.url) —
  // translate the legacy `query` override into the real url so tests match.
  const { query, ...rest } = overrides
  const req = { method: 'GET', headers: {}, ...rest }
  if (query && Object.keys(query).length) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) params.set(k, v)
    req.url = `${req.url?.split('?')[0] || '/'}?${params}`
  }
  return req
}

function cookieHeader(res) {
  const sc = res.getHeader('set-cookie')
  const list = Array.isArray(sc) ? sc : [sc].filter(Boolean)
  const pair = list.find((c) => c.startsWith(`${sessionCookie.cookieName}=`))
  return pair ? pair.split(';')[0] : null
}

async function decode(cookieValue) {
  const req = mockReq({ headers: { cookie: cookieValue } })
  const res = mockRes()
  return getIronSession(req, res, sessionCookie)
}

// Mint a sealed cookie carrying the given session fields (via getSession so
// persistent sessions get the real 30-day config).
async function seal(fields, { persistent = false } = {}) {
  const res = mockRes()
  const s = await getSession(mockReq(), res, { persistent })
  Object.assign(s, fields)
  await s.save()
  return cookieHeader(res)
}

// Deterministic clock: patch Date.now for the duration of fn.
async function withNow(ms, fn) {
  const real = Date.now
  Date.now = () => ms
  try {
    return await fn()
  } finally {
    Date.now = real
  }
}

function mockGithub(t) {
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('login/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'tok' }), { headers: { 'Content-Type': 'application/json' } })
    }
    if (u.includes('api.github.com/user')) {
      return new Response(JSON.stringify({ id: 7, login: 'user', node_id: 'n', avatar_url: '', name: 'U' }), { headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 404 })
  }
  t.after(() => { globalThis.fetch = origFetch })
}

// login → callback with mocked GitHub → the emitted session cookie.
async function loginViaRoutes(t, { remember = false } = {}) {
  const resLogin = mockRes()
  await loginHandler(mockReq({ query: remember ? { remember: '1' } : {} }), resLogin)
  const state = new URL(resLogin.getHeader('location')).searchParams.get('state')
  mockGithub(t)
  const resCb = mockRes()
  await callbackHandler(
    mockReq({ headers: { cookie: cookieHeader(resLogin) }, query: { code: 'c', state } }),
    resCb
  )
  assert.notEqual(resCb.statusCode, 400, resCb.body?.error)
  return cookieHeader(resCb)
}

/* ── lease minting ── */

test('non-persistent callback mints leaseUntil ≈ now + lease', async (t) => {
  const t0 = 1_800_000_000_000
  const cookie = await withNow(t0, () => loginViaRoutes(t))
  const s = await decode(cookie)
  assert.equal(s.userId, '7')
  assert.equal(s.persistent, false)
  assert.ok(s.leaseUntil >= t0 + sessionLeaseMs - 1000 && s.leaseUntil <= t0 + sessionLeaseMs + 1000,
    `leaseUntil ${s.leaseUntil} ≈ ${t0 + sessionLeaseMs}`)
})

test('persistent callback does not mint a short lease', async (t) => {
  const cookie = await loginViaRoutes(t, { remember: true })
  const s = await decode(cookie)
  assert.equal(s.persistent, true)
  assert.equal(s.leaseUntil, undefined)
})

/* ── validation ── */

test('valid non-persistent lease authenticates /api/user', async (t) => {
  const cookie = await loginViaRoutes(t)
  const res = mockRes()
  await userHandler(mockReq({ headers: { cookie } }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.authenticated, true)
  assert.equal(res.body.persistent, false)
})

test('expired lease → /api/user 401 and the stale cookie is cleared', async (t) => {
  const cookie = await seal({ userId: 'u1', persistent: false, leaseUntil: Date.now() - 1000 })
  const res = mockRes()
  await userHandler(mockReq({ headers: { cookie } }), res)
  assert.equal(res.statusCode, 401)
  const sc = res.getHeader('set-cookie')
  const cleared = (Array.isArray(sc) ? sc : [sc]).find((c) => c.startsWith(`${sessionCookie.cookieName}=`))
  assert.ok(cleared && /Max-Age=0/i.test(cleared), 'expired session must emit a clearing Set-Cookie')
})

test('missing leaseUntil on a non-persistent session → 401 (legacy migration)', async (t) => {
  const cookie = await seal({ userId: 'legacy', persistent: false })
  const res = mockRes()
  await userHandler(mockReq({ headers: { cookie } }), res)
  assert.equal(res.statusCode, 401)
})

test('persistent session without leaseUntil keeps working past the lease window', async (t) => {
  const cookie = await seal({ userId: 'rem', persistent: true }, { persistent: true })
  const res = mockRes()
  await withNow(Date.now() + 60 * MIN, () =>
    userHandler(mockReq({ headers: { cookie } }), res))
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.persistent, true)
})

test('tampered leaseUntil fails seal validation', async () => {
  const cookie = await seal({ userId: 'u1', persistent: false, leaseUntil: Date.now() + sessionLeaseMs })
  const mid = Math.floor(cookie.length / 2)
  const forged = cookie.slice(0, mid) + (cookie[mid] === 'A' ? 'B' : 'A') + cookie.slice(mid + 1)
  const res = mockRes()
  await userHandler(mockReq({ headers: { cookie: forged } }), res)
  assert.equal(res.statusCode, 401)
})

/* ── validation-only: getSession NEVER renews ──
   Renewal happens exclusively via POST /api/auth/heartbeat — arbitrary API
   traffic (dashboard/sync/user reads) must not slide the lease, or
   background polling would keep an idle session immortal. */

test('getSession validates without renewing — >50% remaining', async () => {
  const now = Date.now()
  const cookie = await seal({ userId: 'u1', persistent: false, leaseUntil: now + sessionLeaseMs * 0.8 })
  const res = mockRes()
  const s = await getSession(mockReq({ headers: { cookie } }), res)
  assert.equal(s.userId, 'u1')
  assert.equal(res.getHeader('set-cookie'), undefined, 'no Set-Cookie on validate')
})

test('getSession validates without renewing — even <50% remaining', async () => {
  const now = Date.now()
  const cookie = await seal({ userId: 'u1', persistent: false, leaseUntil: now + sessionLeaseMs * 0.2 })
  const res = mockRes()
  const s = await getSession(mockReq({ headers: { cookie } }), res)
  assert.equal(s.userId, 'u1', 'still-valid lease authenticates')
  assert.equal(res.getHeader('set-cookie'), undefined, 'piggyback renewal removed — no Set-Cookie')
})

test('/api/user is validation-only — no lease renewal near expiry', async () => {
  const now = Date.now()
  const cookie = await seal({ userId: 'u1', persistent: false, leaseUntil: now + sessionLeaseMs * 0.1 })
  const res = mockRes()
  await userHandler(mockReq({ headers: { cookie } }), res)
  assert.equal(res.statusCode, 200)
  assert.ok(!cookieHeader(res), '/api/user must not extend the lease')
})

test('requireUser path (sync/dashboard) is validation-only', () => {
  const req = src('lib/require-user.mjs')
  assert.ok(req.includes('getSession'), 'requireUser uses the central helper')
  assert.ok(!req.includes('leaseUntil'), 'no renewal logic in requireUser')
  const auth = src('lib/auth.mjs')
  const fn = auth.slice(auth.indexOf('export async function getSession'))
  assert.ok(!fn.includes('leaseUntil = now + sessionLeaseMs'), 'getSession must not write leaseUntil')
  assert.ok(!fn.includes('session.save()'), 'getSession must not save')
})

/* ── heartbeat route ── */

test('heartbeat renews a valid non-persistent lease', async () => {
  const now = Date.now()
  const cookie = await seal({ userId: 'u1', persistent: false, leaseUntil: now + sessionLeaseMs * 0.8 })
  const res = mockRes()
  await heartbeatHandler(mockReq({ method: 'POST', headers: { cookie, origin: ORIGIN } }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)
  const renewed = await decode(cookieHeader(res))
  assert.ok(renewed.leaseUntil >= now + sessionLeaseMs - 1000, 'heartbeat must extend the lease')
})

test('heartbeat on a persistent session reports persistent, no lease imposed', async () => {
  const cookie = await seal({ userId: 'rem', persistent: true }, { persistent: true })
  const res = mockRes()
  await heartbeatHandler(mockReq({ method: 'POST', headers: { cookie, origin: ORIGIN } }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.persistent, true)
  const decoded = await decode(cookieHeader(res) || cookie)
  assert.equal(decoded.leaseUntil, undefined)
})

test('heartbeat is 401 unauthenticated and on an expired lease', async () => {
  const anon = mockRes()
  await heartbeatHandler(mockReq({ method: 'POST', headers: { origin: ORIGIN } }), anon)
  assert.equal(anon.statusCode, 401)

  const stale = await seal({ userId: 'u1', persistent: false, leaseUntil: Date.now() - 1000 })
  const res = mockRes()
  await heartbeatHandler(mockReq({ method: 'POST', headers: { cookie: stale, origin: ORIGIN } }), res)
  assert.equal(res.statusCode, 401)
})

/* ── route-level timeline (spec §27) ── */

test('heartbeat at t+4m keeps the session alive at t+8m', async (t) => {
  const t0 = 1_800_000_000_000
  const cookie = await withNow(t0, () => loginViaRoutes(t))

  const resT0 = mockRes()
  await withNow(t0, () => userHandler(mockReq({ headers: { cookie } }), resT0))
  assert.equal(resT0.statusCode, 200)

  const resBeat = mockRes()
  await withNow(t0 + 4 * MIN, () =>
    heartbeatHandler(mockReq({ method: 'POST', headers: { cookie, origin: ORIGIN } }), resBeat))
  assert.equal(resBeat.statusCode, 200)
  const renewed = cookieHeader(resBeat)

  const resT8 = mockRes()
  await withNow(t0 + 8 * MIN, () =>
    userHandler(mockReq({ headers: { cookie: renewed } }), resT8))
  assert.equal(resT8.statusCode, 200, 'renewed at +4m → still valid at +8m')
})

test('no contact for >5m → /api/user 401', async (t) => {
  const t0 = 1_800_000_000_000
  const cookie = await withNow(t0, () => loginViaRoutes(t))
  const res = mockRes()
  await withNow(t0 + sessionLeaseMs + MIN, () =>
    userHandler(mockReq({ headers: { cookie } }), res))
  assert.equal(res.statusCode, 401)
})

test('expired-lease cookie does not break a fresh login', async (t) => {
  // Login is a write path (mutates + saves): an expired-lease session must be
  // cleared without destroy(), or save() would throw on the destroyed session.
  const stale = await seal({ userId: 'stale', persistent: false, leaseUntil: Date.now() - 1000 })
  const res = mockRes()
  await loginHandler(mockReq({ headers: { cookie: stale } }), res)
  assert.equal(res.statusCode, 302, 'login must still redirect to GitHub')
  const fresh = await decode(cookieHeader(res))
  assert.equal(fresh.userId, undefined, 'stale identity must not carry into the new session')
  assert.ok(fresh.oauthState, 'fresh OAuth state minted')
})

test('logout destroys an expired-lease session cleanly', async () => {
  const stale = await seal({ userId: 'u1', persistent: false, leaseUntil: Date.now() - 1000 })
  const res = mockRes()
  await logoutHandler(mockReq({ method: 'POST', headers: { cookie: stale, origin: ORIGIN } }), res)
  assert.equal(res.statusCode, 200)
})

/* ── frontend heartbeat model + wiring guards ── */

test('shouldHeartbeat gates on authenticated + non-persistent', async () => {
  const { shouldHeartbeat, heartbeatOutcome, HEARTBEAT_INTERVAL_MS, HEARTBEAT_URL } =
    await import('../src/ledger/heartbeatModel.mjs')
  assert.equal(HEARTBEAT_INTERVAL_MS, 60_000)
  assert.equal(HEARTBEAT_URL, '/api/auth/heartbeat')
  assert.equal(shouldHeartbeat({ authenticated: true, persistent: false }), true)
  assert.equal(shouldHeartbeat({ authenticated: true }), true)
  assert.equal(shouldHeartbeat({ authenticated: true, persistent: true }), false)
  assert.equal(shouldHeartbeat({ authenticated: false }), false)
  assert.equal(heartbeatOutcome(401), 'logout')
  assert.equal(heartbeatOutcome(200), 'stay')
  assert.equal(heartbeatOutcome(500), 'stay')
})

test('Gate wires the heartbeat with lifecycle cleanup', () => {
  const m = src('src/main.tsx')
  assert.ok(m.includes('HEARTBEAT_INTERVAL_MS'), 'interval comes from the shared model')
  assert.ok(m.includes('HEARTBEAT_URL'), 'endpoint comes from the shared model')
  assert.ok(m.includes("addEventListener(\"focus\"") || m.includes("addEventListener('focus'"), 'focus beat')
  assert.ok(m.includes('visibilitychange'), 'visibility beat')
  assert.ok(m.includes('clearInterval'), 'timer cleaned up on unmount/logout')
  assert.ok(m.includes('shouldHeartbeat'), 'gated on non-persistent sessions')
  assert.ok(m.includes('removeEventListener'), 'listeners cleaned up')
})

test('/api/user exposes the persistent flag the heartbeat gate needs', () => {
  assert.ok(src('api/user.mjs').includes('persistent: session.persistent === true'))
})
