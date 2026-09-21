import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getIronSession } from 'iron-session'
import { cookie as sessionCookie } from '../lib/config.mjs'
import loginHandler from '../api/auth/login.mjs'
import logoutHandler from '../api/auth/logout.mjs'
import callbackHandler from '../api/auth/callback.mjs'

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
  return { method: 'GET', headers: {}, query: {}, ...overrides }
}

function cookieHeader(res) {
  const sc = res.getHeader('set-cookie')
  const list = Array.isArray(sc) ? sc : [sc].filter(Boolean)
  const pair = list.find((c) => c.startsWith(`${sessionCookie.cookieName}=`))
  return pair ? pair.split(';')[0] : null
}

function authorizeUrl(res) {
  const loc = res.getHeader('location')
  assert.ok(loc, 'login must redirect to GitHub authorize')
  const url = new URL(loc)
  assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize')
  return url
}

async function sessionFromCookie(cookieValue) {
  const req = mockReq({ headers: { cookie: cookieValue } })
  const res = mockRes()
  const session = await getIronSession(req, res, sessionCookie)
  return session
}

test('authorize URL includes prompt=select_account alongside client_id/redirect_uri/state', async () => {
  const res = mockRes()
  await loginHandler(mockReq(), res)
  assert.equal(res.statusCode, 302)
  const url = authorizeUrl(res)
  assert.equal(url.searchParams.get('prompt'), 'select_account')
  assert.ok(url.searchParams.has('client_id'))
  assert.ok(url.searchParams.get('redirect_uri').endsWith('/api/auth/callback'))
  assert.ok(url.searchParams.get('state').length > 8)
})

test('each login issues a fresh OAuth state', async () => {
  const res1 = mockRes()
  const res2 = mockRes()
  await loginHandler(mockReq(), res1)
  await loginHandler(mockReq(), res2)
  const s1 = authorizeUrl(res1).searchParams.get('state')
  const s2 = authorizeUrl(res2).searchParams.get('state')
  assert.notEqual(s1, s2)
  assert.notEqual(cookieHeader(res1), cookieHeader(res2))
})

test('logout expires the session cookie', async () => {
  const res = mockRes()
  await logoutHandler(mockReq(), res)
  assert.equal(res.statusCode, 302)
  const sc = res.getHeader('set-cookie')
  const expired = (Array.isArray(sc) ? sc : [sc]).find((c) => c.startsWith(`${sessionCookie.cookieName}=`))
  assert.ok(expired, 'logout must emit a Set-Cookie for the session cookie')
  assert.match(expired, /Max-Age=0/)
})

test('account A → logout → login → callback as account B stores only identity B', async (t) => {
  // Session for account A
  const reqA = mockReq()
  const resA = mockRes()
  const sessionA = await getIronSession(reqA, resA, sessionCookie)
  sessionA.userId = 'user-a'
  sessionA.githubLogin = 'account-a'
  await sessionA.save()
  const cookieA = cookieHeader(resA)
  assert.ok(cookieA)
  assert.equal((await sessionFromCookie(cookieA)).userId, 'user-a')

  // Logout A — the emitted cookie is expired/empty
  const resOut = mockRes()
  await logoutHandler(mockReq({ headers: { cookie: cookieA } }), resOut)
  const cleared = cookieHeader(resOut)
  assert.equal(cleared, `${sessionCookie.cookieName}=`)

  // New login produces a fresh state and a session without identity A
  const resLogin = mockRes()
  await loginHandler(mockReq(), resLogin)
  const state = authorizeUrl(resLogin).searchParams.get('state')
  const loginCookie = cookieHeader(resLogin)
  const pending = await sessionFromCookie(loginCookie)
  assert.equal(pending.userId, undefined)
  assert.equal(pending.githubLogin, undefined)

  // GitHub returns account B — mock the token exchange + user lookup
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('login/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'tok-b' }), { headers: { 'Content-Type': 'application/json' } })
    }
    if (u.includes('api.github.com/user')) {
      return new Response(JSON.stringify({ id: 4242, login: 'account-b', node_id: 'n42', avatar_url: '', name: 'B' }), { headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 404 })
  }
  t.after(() => { globalThis.fetch = origFetch })

  const resCb = mockRes()
  await callbackHandler(
    mockReq({ headers: { cookie: loginCookie }, query: { code: 'gh-code', state } }),
    resCb
  )
  assert.notEqual(resCb.statusCode, 400, resCb.body?.error)
  const finalCookie = cookieHeader(resCb)
  const finalSession = await sessionFromCookie(finalCookie)
  assert.equal(finalSession.userId, '4242')
  assert.equal(finalSession.githubLogin, 'account-b')
  assert.notEqual(finalSession.userId, 'user-a')
})

test('callback rejects a stale/mismatched OAuth state', async () => {
  const resLogin = mockRes()
  await loginHandler(mockReq(), resLogin)
  const resCb = mockRes()
  await callbackHandler(
    mockReq({ headers: { cookie: cookieHeader(resLogin) }, query: { code: 'x', state: 'forged' } }),
    resCb
  )
  assert.equal(resCb.statusCode, 400)
})

test('default login emits a true session cookie — no Max-Age/Expires', async () => {
  const res = mockRes()
  await loginHandler(mockReq(), res)
  const sc = res.getHeader('set-cookie')
  const c = (Array.isArray(sc) ? sc : [sc]).find((x) => x.startsWith(`${sessionCookie.cookieName}=`))
  assert.ok(c, 'login must emit the session cookie')
  assert.doesNotMatch(c, /Max-Age=/i)
  assert.doesNotMatch(c, /Expires=/i)
})

test('remember=1 login emits a persistent ~30-day cookie carrying the flag', async () => {
  const res = mockRes()
  await loginHandler(mockReq({ query: { remember: '1' } }), res)
  const sc = res.getHeader('set-cookie')
  const c = (Array.isArray(sc) ? sc : [sc]).find((x) => x.startsWith(`${sessionCookie.cookieName}=`))
  assert.ok(c, 'login must emit the session cookie')
  const m = c.match(/Max-Age=(\d+)/i)
  assert.ok(m, 'persistent login must emit Max-Age')
  const secs = Number(m[1])
  assert.ok(secs > 2_500_000 && secs <= 30 * 24 * 3600, `expected ~30d Max-Age, got ${secs}`)
  const pending = await sessionFromCookie(cookieHeader(res))
  assert.equal(pending.remember, true)
})

test('callback converts the remember flag into a persistent session cookie', async (t) => {
  const resLogin = mockRes()
  await loginHandler(mockReq({ query: { remember: '1' } }), resLogin)
  const state = authorizeUrl(resLogin).searchParams.get('state')
  const loginCookie = cookieHeader(resLogin)

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

  const resCb = mockRes()
  await callbackHandler(
    mockReq({ headers: { cookie: loginCookie }, query: { code: 'c', state } }),
    resCb
  )
  assert.notEqual(resCb.statusCode, 400, resCb.body?.error)
  const sc = resCb.getHeader('set-cookie')
  const c = (Array.isArray(sc) ? sc : [sc]).find((x) => x.startsWith(`${sessionCookie.cookieName}=`))
  assert.match(c, /Max-Age=\d+/i, 'callback must emit the persistent cookie')
  const final = await sessionFromCookie(cookieHeader(resCb))
  assert.equal(final.persistent, true)
  assert.equal(final.remember, undefined)
})

test('logout clears a persistent session cookie too', async () => {
  const resLogin = mockRes()
  await loginHandler(mockReq({ query: { remember: '1' } }), resLogin)
  const resOut = mockRes()
  await logoutHandler(mockReq({ headers: { cookie: cookieHeader(resLogin) } }), resOut)
  assert.equal(cookieHeader(resOut), `${sessionCookie.cookieName}=`)
})

test('a sealed remember flag without OAuth state cannot authenticate', async () => {
  // A stale/replayed session carrying remember+persistent but no oauthState
  // must still fail state validation — the flag never skips the check.
  const req = mockReq()
  const res = mockRes()
  const s = await getIronSession(req, res, sessionCookie)
  s.remember = true
  s.persistent = true
  await s.save()
  const resCb = mockRes()
  await callbackHandler(
    mockReq({ headers: { cookie: cookieHeader(res) }, query: { code: 'x', state: 'whatever' } }),
    resCb
  )
  assert.equal(resCb.statusCode, 400)
})

test('a tampered session cookie cannot bypass OAuth state validation', async () => {
  const resLogin = mockRes()
  await loginHandler(mockReq({ query: { remember: '1' } }), resLogin)
  const good = cookieHeader(resLogin)
  const state = authorizeUrl(resLogin).searchParams.get('state')
  // Corrupt a character mid-seal — unseal must fail → empty session → the
  // real (valid) state no longer matches, so the callback rejects before
  // ever attempting the token exchange.
  const [name, value] = good.split('=')
  const mid = Math.floor(value.length / 2)
  const forged = `${name}=${value.slice(0, mid)}${value[mid] === 'A' ? 'B' : 'A'}${value.slice(mid + 1)}`
  let fetchCalled = false
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => { fetchCalled = true; return new Response('{}', { status: 404 }) }
  try {
    const resCb = mockRes()
    await callbackHandler(
      mockReq({ headers: { cookie: forged }, query: { code: 'x', state } }),
      resCb
    )
    assert.equal(resCb.statusCode, 400)
    assert.equal(resCb.body?.error, 'Invalid OAuth state')
    assert.equal(fetchCalled, false, 'token exchange must not be attempted')
  } finally {
    globalThis.fetch = origFetch
  }
})
