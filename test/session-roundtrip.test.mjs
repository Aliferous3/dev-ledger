import { test } from 'node:test'
import assert from 'node:assert/strict'

// Session-cookie persistence regression: emits a real Set-Cookie via save(),
// then feeds the cookie back through getSession on a simulated subsequent
// request (page refresh / new tab / navigation). This is the lifecycle that
// broke in production — attributes alone can't catch it.
//
// KNOWN CAVEAT (accepted behavior): a browser-session cookie only guarantees
// expiry when the browser's own notion of a session ends. Firefox Session
// Restore (browser.startup.page=3, resume_session_once, crash recovery)
// deliberately restores session cookies — verified in production QA — and a
// resident browser process keeps them alive too. Do not "fix" this by adding
// Max-Age, JS logout hooks, or client-memory gates; it is standards-compliant
// session semantics. See AGENTS.md.

const { getSession } = await import('../lib/auth.mjs')

function makeRes() {
  const headers = {}
  return {
    headers,
    setHeader: (k, v) => (headers[k.toLowerCase()] = v),
    getHeader: (k) => headers[k.toLowerCase()],
  }
}

function setCookies(res) {
  const sc = res.headers['set-cookie']
  return Array.isArray(sc) ? sc : sc ? [sc] : []
}

// Fold a response's Set-Cookie headers into a Cookie request header value.
function cookieHeader(res) {
  return setCookies(res)
    .map((s) => s.split(';')[0])
    .filter(Boolean)
    .join('; ')
}

test('default session cookie authenticates a subsequent request (refresh)', async () => {
  const res1 = makeRes()
  const s1 = await getSession({ headers: {} }, res1)
  s1.userId = 'user-1'
  s1.persistent = false
  await s1.save()

  const sc = setCookies(res1)[0]
  assert.ok(sc.startsWith('dev_ledger_session='), 'cookie emitted')
  assert.ok(!/max-age=/i.test(sc), 'no Max-Age → browser-session cookie')
  assert.ok(!/expires=/i.test(sc), 'no Expires')
  assert.match(sc, /Path=\//)
  assert.match(sc, /HttpOnly/i)
  assert.match(sc, /SameSite=Lax/i)

  // Simulated page reload: new request carrying the cookie.
  const res2 = makeRes()
  const s2 = await getSession({ headers: { cookie: cookieHeader(res1) } }, res2)
  assert.equal(s2.userId, 'user-1', 'session must decode after refresh')
})

test('remember cookie authenticates a subsequent request with 30-day persistence', async () => {
  const res1 = makeRes()
  const s1 = await getSession({ headers: {} }, res1, { persistent: true })
  s1.userId = 'user-2'
  s1.persistent = true
  await s1.save()

  const sc = setCookies(res1)[0]
  const m = sc.match(/Max-Age=(\d+)/i)
  assert.ok(m, 'persistent cookie needs an explicit Max-Age')
  const secs = Number(m[1])
  assert.ok(secs > 60 * 60 * 24 * 29 && secs <= 60 * 60 * 24 * 30, `~30d Max-Age, got ${secs}`)

  const res2 = makeRes()
  const s2 = await getSession({ headers: { cookie: cookieHeader(res1) } }, res2)
  assert.equal(s2.userId, 'user-2', 'persistent session decodes')
  assert.equal(s2.persistent, true, 'persistent flag survives inside the seal')
})

test('both cookie modes share one seal format — cross-decode works', async () => {
  // A cookie written by the session-scoped config must decode even when the
  // reader resolves the persistent config (and vice versa): same name,
  // password and encryption — only outgoing attributes differ.
  const resA = makeRes()
  const a = await getSession({ headers: {} }, resA) // session-scoped write
  a.userId = 'cross-a'
  a.persistent = false
  await a.save()

  const resB = makeRes()
  const b = await getSession({ headers: {} }, resB, { persistent: true }) // persistent write
  b.userId = 'cross-b'
  b.persistent = true
  await b.save()

  const ra = makeRes()
  const da = await getSession({ headers: { cookie: cookieHeader(resA) } }, ra)
  assert.equal(da.userId, 'cross-a')

  const rb = makeRes()
  const db = await getSession({ headers: { cookie: cookieHeader(resB) } }, rb)
  assert.equal(db.userId, 'cross-b')
})

test('oauth round-trip: login state cookie → callback read → refreshed session', async () => {
  // login: pending session carries oauthState + remember flag
  const res1 = makeRes()
  const s1 = await getSession({ headers: {} }, res1, { persistent: false })
  s1.oauthState = 'st8'
  s1.remember = false
  s1.persistent = false
  await s1.save()

  // callback: same cookie in → state validates → authenticated session out
  const res2 = makeRes()
  const s2 = await getSession({ headers: { cookie: cookieHeader(res1) } }, res2)
  assert.equal(s2.oauthState, 'st8')
  delete s2.oauthState
  s2.persistent = s2.remember === true
  delete s2.remember
  s2.userId = 'user-3'
  await s2.save()
  assert.ok(!/max-age=/i.test(setCookies(res2)[0]), 'unchecked login stays session-scoped')

  // refresh after callback: authenticated user decodes
  const res3 = makeRes()
  const s3 = await getSession({ headers: { cookie: cookieHeader(res2) } }, res3)
  assert.equal(s3.userId, 'user-3')
  assert.equal(s3.oauthState, undefined)
})

test('remember preference flows through the oauth round-trip into a persistent cookie', async () => {
  const res1 = makeRes()
  const s1 = await getSession({ headers: {} }, res1, { persistent: true })
  s1.oauthState = 'st9'
  s1.remember = true
  s1.persistent = true
  await s1.save()

  const res2 = makeRes()
  const s2 = await getSession({ headers: { cookie: cookieHeader(res1) } }, res2)
  assert.equal(s2.remember, true, 'flag survives inside the sealed cookie')
  delete s2.oauthState
  s2.persistent = s2.remember === true
  delete s2.remember
  s2.userId = 'user-4'
  await s2.save()
  assert.match(setCookies(res2)[0], /Max-Age=\d+/i, 'checked login emits persistence')

  const res3 = makeRes()
  const s3 = await getSession({ headers: { cookie: cookieHeader(res2) } }, res3)
  assert.equal(s3.userId, 'user-4')
  assert.equal(s3.persistent, true)
})

test('logout clears both cookie variants and later requests decode empty', async () => {
  for (const persistent of [false, true]) {
    const res1 = makeRes()
    const s1 = await getSession({ headers: {} }, res1, { persistent })
    s1.userId = 'bye'
    s1.persistent = persistent
    await s1.save()

    const res2 = makeRes()
    const s2 = await getSession({ headers: { cookie: cookieHeader(res1) } }, res2)
    await s2.destroy()
    const del = setCookies(res2).join(';')
    assert.match(del, /dev_ledger_session=;/, 'cookie name cleared')
    assert.match(del, /Max-Age=0/i, 'expired immediately')

    const res3 = makeRes()
    const s3 = await getSession({ headers: { cookie: cookieHeader(res2) } }, res3)
    assert.equal(s3.userId, undefined, `persistent=${persistent}: no session after logout`)
  }
})

test('a tampered cookie decodes to an empty session, never to auth', async () => {
  const res1 = makeRes()
  const s1 = await getSession({ headers: {} }, res1)
  s1.userId = 'victim'
  await s1.save()

  const raw = cookieHeader(res1)
  const mid = Math.floor(raw.length / 2)
  const forged = raw.slice(0, mid) + (raw[mid] === 'A' ? 'B' : 'A') + raw.slice(mid + 1)

  const res2 = makeRes()
  const s2 = await getSession({ headers: { cookie: forged } }, res2)
  assert.equal(s2.userId, undefined, 'tampered seal must not authenticate')
})
