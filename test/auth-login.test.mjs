import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { getIronSession } from 'iron-session'
import { cookie as sessionCookie, appUrl } from '../lib/config.mjs'
import loginHandler from '../api/auth/login.mjs'
import logoutHandler from '../api/auth/logout.mjs'
import callbackHandler from '../api/auth/callback.mjs'
import userHandler from '../api/user.mjs'

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

// Logout is POST-only + same-origin guarded — the request shape the
// frontend's sign-out fetch produces.
const ORIGIN = new URL(appUrl).origin
const logoutReq = (headers = {}) => mockReq({ method: 'POST', headers: { origin: ORIGIN, ...headers } })

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

test('GitHub code exchange uses documented form encoding with matching callback URI', async (t) => {
  const resLogin = mockRes()
  await loginHandler(mockReq(), resLogin)
  const authorization = authorizeUrl(resLogin)
  const state = authorization.searchParams.get('state')
  const redirectUri = authorization.searchParams.get('redirect_uri')
  const clientId = authorization.searchParams.get('client_id')
  let exchangeCount = 0
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url, opts) => {
    const endpoint = String(url)
    if (endpoint === 'https://github.com/login/oauth/access_token') {
      exchangeCount++
      assert.equal(opts.method, 'POST')
      assert.equal(opts.headers.Accept, 'application/json')
      assert.equal(opts.headers['Content-Type'], 'application/x-www-form-urlencoded')
      const params = new URLSearchParams(opts.body)
      assert.equal(params.get('client_id'), clientId)
      assert.equal(params.get('code'), 'single-use-test-code')
      assert.equal(params.get('redirect_uri'), redirectUri)
      assert.ok(params.has('client_secret'))
      assert.equal(params.getAll('code').length, 1)
      assert.ok(!endpoint.includes('single-use-test-code'))
      return new Response(JSON.stringify({ access_token: 'test-access-token' }),
        { headers: { 'Content-Type': 'application/json' } })
    }
    if (endpoint.includes('api.github.com/user')) {
      return new Response(JSON.stringify({
        id: 777, login: 'test-user', node_id: 'node777', avatar_url: '', name: 'Test User',
      }), { headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 404 })
  }
  t.after(() => { globalThis.fetch = origFetch })

  const resCb = mockRes()
  await callbackHandler(
    mockReq({ headers: { cookie: cookieHeader(resLogin) },
      query: { code: 'single-use-test-code', state } }), resCb
  )
  assert.equal(exchangeCount, 1)
  assert.equal(resCb.statusCode, 302, 'successful OAuth callback must redirect')
  assert.equal(resCb.getHeader('location'), '/')
})

test('a GitHub bad_verification_code failure records only safe OAuth age and consumes state', async (t) => {
  const desktop = mockRes()
  const flow = '9f5a9d2c-2d46-42ff-8f91-e4c93814e055'
  await loginHandler(mockReq({
    query: { desktop_flow: flow, desktop_challenge: 'a'.repeat(64) },
  }), desktop)
  const state = authorizeUrl(desktop).searchParams.get('state')
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'https://github.com/login/oauth/access_token')
    return new Response(JSON.stringify({
      error: 'bad_verification_code',
      error_description: 'The code passed is incorrect or expired.',
    }), { headers: { 'Content-Type': 'application/json' } })
  }
  t.after(() => { globalThis.fetch = originalFetch })
  const originalError = console.error
  const errors = []
  console.error = (...parts) => errors.push(parts)
  t.after(() => { console.error = originalError })

  const callback = mockRes()
  await callbackHandler(mockReq({
    headers: { cookie: cookieHeader(desktop) },
    query: { code: 'one-time-placeholder', state },
  }), callback)

  assert.equal(callback.statusCode, 400)
  assert.equal(callback.body?.error, 'GitHub token exchange failed')
  const detail = errors.find((parts) => String(parts[0]).includes('github token exchange failed:'))
  assert.ok(detail, 'diagnostic must emit a bounded, credential-free error')
  assert.equal(detail[4], 'desktop')
  assert.equal(typeof detail[5], 'number')
  assert.ok(detail[5] >= 0 && detail[5] < 900)
  assert.match(detail[6], /^(?:[a-f0-9]{16}|unavailable)$/)
  assert.ok(!JSON.stringify(errors).includes('one-time-placeholder'), 'OAuth code must never be logged')
  assert.ok(!JSON.stringify(errors).includes(state), 'OAuth state must never be logged')
  const finalCookie = cookieHeader(callback)
  const sealed = await sessionFromCookie(finalCookie)
  assert.equal(sealed.oauthAttempts?.length, 0, 'failed exchanges consume their pending attempt')
})

test('duplicate desktop callbacks share a one-way fingerprint without logging OAuth secrets', async (t) => {
  const flow = '9f5a9d2c-2d46-42ff-8f91-e4c93814e055'
  const login = mockRes()
  await loginHandler(mockReq({
    query: { desktop_flow: flow, desktop_challenge: 'a'.repeat(64) },
  }), login)
  const state = authorizeUrl(login).searchParams.get('state')
  const cookie = cookieHeader(login)
  const originalFetch = globalThis.fetch
  let exchanges = 0
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('login/oauth/access_token')) {
      exchanges++
      return new Response(JSON.stringify(exchanges === 1
        ? { access_token: 'fake-test-token' }
        : { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' }),
        { headers: { 'Content-Type': 'application/json' } })
    }
    if (u.includes('api.github.com/user')) {
      return new Response(JSON.stringify({ id: 4242, login: 'account-b', node_id: 'n42', avatar_url: '', name: 'B' }),
        { headers: { 'Content-Type': 'application/json' } })
    }
    if (u.includes('api.github.com/user/installations')) {
      return new Response(JSON.stringify({ total_count: 0, installations: [] }),
        { headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({}), { status: 404 })
  }
  t.after(() => { globalThis.fetch = originalFetch })
  const priorInfo = console.info
  const priorError = console.error
  const infos = []
  const errors = []
  console.info = (...parts) => infos.push(parts)
  console.error = (...parts) => errors.push(parts)
  t.after(() => { console.info = priorInfo; console.error = priorError })

  // Both requests present the same original cookie. This models concurrent
  // browser callback requests, not a replay from the post-success cookie.
  const first = mockRes()
  await callbackHandler(mockReq({
    headers: { cookie }, query: { code: 'fake-one-use-code', state },
  }), first)
  const second = mockRes()
  await callbackHandler(mockReq({
    headers: { cookie }, query: { code: 'fake-one-use-code', state },
  }), second)
  assert.equal(exchanges, 2)
  assert.equal(first.statusCode, 302)
  assert.equal(second.statusCode, 400)
  const successLog = infos.find((parts) => String(parts[0]).includes('github oauth token exchange accepted:'))
  const failureLog = errors.find((parts) => String(parts[0]).includes('github token exchange failed:'))
  assert.ok(successLog)
  assert.ok(failureLog)
  assert.match(successLog[2], /^[a-f0-9]{16}$/)
  assert.equal(failureLog[6], successLog[2], 'both callback attempts correlate without exposing raw state')
  const logged = JSON.stringify({ infos, errors })
  assert.ok(!logged.includes('fake-one-use-code'))
  assert.ok(!logged.includes(state))
})

test('repeated OAuth code query parameters are rejected before any GitHub exchange', async (t) => {
  const login = mockRes()
  await loginHandler(mockReq(), login)
  const state = authorizeUrl(login).searchParams.get('state')
  const originalFetch = globalThis.fetch
  let exchanged = 0
  globalThis.fetch = async () => {
    exchanged++
    return new Response('{}')
  }
  t.after(() => { globalThis.fetch = originalFetch })
  const res = mockRes()
  await callbackHandler(mockReq({
    headers: { cookie: cookieHeader(login) },
    url: '/api/auth/callback?code=first&code=second&state=' + encodeURIComponent(state),
  }), res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body?.error, 'Invalid OAuth state')
  assert.equal(exchanged, 0, 'repeated authorization codes must not reach the token endpoint')
})

test('web login started during desktop authorization never inherits desktop handoff', async (t) => {
  const flow = '9f5a9d2c-2d46-42ff-8f91-e4c93814e055'
  const challenge = 'a'.repeat(64)
  const desktop = mockRes()
  await loginHandler(mockReq({ query: { desktop_flow: flow, desktop_challenge: challenge } }), desktop)
  const desktopState = authorizeUrl(desktop).searchParams.get('state')
  const startSession = await sessionFromCookie(cookieHeader(desktop))
  assert.equal(startSession.desktopFlow, flow)
  assert.equal(startSession.desktopChallenge, challenge)

  const web = mockRes()
  await loginHandler(mockReq({ headers: { cookie: cookieHeader(desktop) } }), web)
  const webState = authorizeUrl(web).searchParams.get('state')
  assert.notEqual(webState, desktopState)
  const pending = await sessionFromCookie(cookieHeader(web))
  assert.equal(pending.desktopFlow, undefined, 'a web login must clear stale desktop routing')
  assert.equal(pending.desktopChallenge, undefined)
  assert.equal(pending.oauthAttempts.length, 2, 'both CSRF states must remain valid')
  stubGithub(t)

  const webCallback = mockRes()
  await callbackHandler(mockReq({
    headers: { cookie: cookieHeader(web) },
    query: { code: 'fresh-web-code', state: webState },
  }), webCallback)
  assert.equal(webCallback.statusCode, 302)
  assert.equal(webCallback.getHeader('location'), '/', 'web callback must not deep-link')
  const webSession = await sessionFromCookie(cookieHeader(webCallback))
  assert.equal(webSession.desktopFlow, undefined)
  assert.equal(webSession.oauthAttempts.length, 1)

  // A desktop callback may complete later using the updated sealed cookie.
  const desktopCallback = mockRes()
  await callbackHandler(mockReq({
    headers: { cookie: cookieHeader(webCallback) },
    query: { code: 'fresh-desktop-code', state: desktopState },
  }), desktopCallback)
  assert.equal(desktopCallback.statusCode, 302)
  const desktopSession = await sessionFromCookie(cookieHeader(desktopCallback))
  assert.equal(desktopSession.desktopFlow, flow)
  assert.equal(desktopSession.desktopChallenge, challenge)
  assert.equal(desktopSession.oauthAttempts.length, 0)
})

test('desktop callback restores its own keep-signed-in choice after a web login starts', async (t) => {
  const flow = '9f5a9d2c-2d46-42ff-8f91-e4c93814e055'
  const challenge = 'b'.repeat(64)
  const desktop = mockRes()
  await loginHandler(mockReq({
    query: { desktop_flow: flow, desktop_challenge: challenge, remember: '1' },
  }), desktop)
  const state = authorizeUrl(desktop).searchParams.get('state')
  const web = mockRes()
  await loginHandler(mockReq({ headers: { cookie: cookieHeader(desktop) } }), web)
  assert.notEqual(authorizeUrl(web).searchParams.get('state'), state)
  stubGithub(t)
  const callback = mockRes()
  await callbackHandler(mockReq({
    headers: { cookie: cookieHeader(web) },
    query: { code: 'unique-desktop-code', state },
  }), callback)
  assert.equal(callback.statusCode, 302)
  const emitted = callback.getHeader('set-cookie')
  const signedCookie = (Array.isArray(emitted) ? emitted : [emitted]).find((v) =>
    v.startsWith('dev_ledger_session='))
  assert.match(signedCookie, /Max-Age=\d+/i, 'persistent desktop attempt must restore its cookie lifetime')
  const sealed = await sessionFromCookie(cookieHeader(callback))
  assert.equal(sealed.persistent, true)
  assert.equal(sealed.desktopFlow, flow)
  assert.equal(sealed.desktopChallenge, challenge)
})

test('once an OAuth callback consumes its state, a callback using the updated cookie is rejected', async (t) => {
  const login = mockRes()
  await loginHandler(mockReq(), login)
  const state = authorizeUrl(login).searchParams.get('state')
  stubGithub(t)
  const callback = mockRes()
  await callbackHandler(mockReq({
    headers: { cookie: cookieHeader(login) },
    query: { code: 'unique-first-code', state },
  }), callback)
  assert.equal(callback.statusCode, 302)
  const repeated = mockRes()
  await callbackHandler(mockReq({
    headers: { cookie: cookieHeader(callback) },
    query: { code: 'unique-second-code', state },
  }), repeated)
  assert.equal(repeated.statusCode, 400)
  assert.equal(repeated.body?.error, 'Invalid OAuth state')
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
  await logoutHandler(logoutReq(), res)
  assert.equal(res.statusCode, 200)
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
  await logoutHandler(logoutReq({ cookie: cookieA }), resOut)
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
  await logoutHandler(logoutReq({ cookie: cookieHeader(resLogin) }), resOut)
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

/* ── route-sequence integration: login → callback → /api/user ────────────
   Mirrors the real browser lifecycle: the callback Set-Cookie alone must
   authenticate /api/user on a fresh request, repeatedly — the behavior the
   dev-bypass regression broke. */

function stubGithub(t, user = { id: 4242, login: 'account-b', node_id: 'n42', avatar_url: '', name: 'B' }) {
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('login/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'tok' }), { headers: { 'Content-Type': 'application/json' } })
    }
    if (u.includes('api.github.com/user')) {
      return new Response(JSON.stringify(user), { headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 404 })
  }
  t.after(() => { globalThis.fetch = origFetch })
}

async function oauthLogin(t, { remember = false } = {}) {
  const resLogin = mockRes()
  await loginHandler(mockReq(remember ? { query: { remember: '1' } } : {}), resLogin)
  assert.equal(resLogin.statusCode, 302)
  const state = authorizeUrl(resLogin).searchParams.get('state')
  const resCb = mockRes()
  await callbackHandler(
    mockReq({ headers: { cookie: cookieHeader(resLogin) }, query: { code: 'gh-code', state } }),
    resCb
  )
  assert.notEqual(resCb.statusCode, 400, resCb.body?.error)
  assert.equal(resCb.statusCode, 302, 'callback redirects after establishing the session')
  const cookie = cookieHeader(resCb)
  assert.ok(cookie, 'callback must emit the session cookie')
  return { cookie, cbRes: resCb }
}

async function getUser(cookie) {
  const res = mockRes()
  await userHandler(mockReq({ headers: cookie ? { cookie } : {} }), res)
  return res
}

test('route sequence: default callback cookie authenticates /api/user — twice', async (t) => {
  stubGithub(t)
  const { cookie, cbRes } = await oauthLogin(t)

  const sc = cbRes.getHeader('set-cookie')
  const emitted = (Array.isArray(sc) ? sc : [sc]).find((x) => x.startsWith(`${sessionCookie.cookieName}=`))
  assert.doesNotMatch(emitted, /Max-Age=/i, 'default callback cookie must not persist')
  assert.doesNotMatch(emitted, /Expires=/i)
  assert.match(emitted, /Path=\//)
  assert.match(emitted, /HttpOnly/i)
  assert.match(emitted, /SameSite=Lax/i)

  const first = await getUser(cookie)
  assert.equal(first.statusCode, 200)
  assert.equal(first.body?.authenticated, true)
  assert.equal(first.body?.user?.githubLogin, 'account-b')

  // Second request with the same cookie — the refresh path.
  const second = await getUser(cookie)
  assert.equal(second.statusCode, 200)
  assert.equal(second.body?.authenticated, true)
  assert.equal(second.body?.user?.githubLogin, 'account-b')
})

test('route sequence: remember callback cookie authenticates /api/user — twice', async (t) => {
  stubGithub(t, { id: 7, login: 'remembered', node_id: 'n', avatar_url: '', name: 'R' })
  const { cookie, cbRes } = await oauthLogin(t, { remember: true })

  const sc = cbRes.getHeader('set-cookie')
  const emitted = (Array.isArray(sc) ? sc : [sc]).find((x) => x.startsWith(`${sessionCookie.cookieName}=`))
  const m = emitted.match(/Max-Age=(\d+)/i)
  assert.ok(m, 'remembered callback cookie must persist')
  assert.ok(Number(m[1]) > 2_500_000 && Number(m[1]) <= 30 * 24 * 3600)

  for (const attempt of [1, 2]) {
    const res = await getUser(cookie)
    assert.equal(res.statusCode, 200, `attempt ${attempt}`)
    assert.equal(res.body?.authenticated, true)
    assert.equal(res.body?.user?.githubLogin, 'remembered')
  }
})

test('/api/user without a cookie reports unauthenticated — never a fake session', async () => {
  const res = await getUser(null)
  assert.equal(res.statusCode, 401)
  assert.equal(res.body?.authenticated, false)
})

test('/api/user with a tampered cookie reports unauthenticated', async (t) => {
  stubGithub(t)
  const { cookie } = await oauthLogin(t)
  const [name, value] = cookie.split('=')
  const mid = Math.floor(value.length / 2)
  const forged = `${name}=${value.slice(0, mid)}${value[mid] === 'A' ? 'B' : 'A'}${value.slice(mid + 1)}`
  const res = await getUser(forged)
  assert.equal(res.statusCode, 401)
  assert.equal(res.body?.authenticated, false)
})

/* ── dev-gate guards: the preview bypass only exists without a real API ── */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (p) => readFileSync(path.join(repoRoot, p), 'utf8')

test('the dev login bypass requires BOTH import.meta.env.DEV and no real API', () => {
  const main = readSrc('src/main.tsx')
  // Under vercel dev /api/user returns JSON → apiPresent=true → no bypass.
  assert.match(main, /import\.meta\.env\.DEV\s*&&\s*!apiPresent/, 'bypass must be gated on apiPresent')
  assert.match(main, /setApiPresent\(isJson \|\| res\.status !== 200\)/, 'apiPresent must come from the /api/user probe — JSON or any non-200 (static fallback is always 200)')
})

test('without the bypass, the CTA navigates to the real /api/auth/login', () => {
  const shared = readSrc('src/ledger/shared.tsx')
  assert.match(shared, /onLogin\s*\?\s*\(\)\s*=>\s*onLogin\(remember\)\s*:\s*startLogin/, 'fallback must be the OAuth redirect')
  assert.match(shared, /window\.location\.assign\(remember \? '\/api\/auth\/login\?remember=1' : '\/api\/auth\/login'\)/, 'remember flag routes through the real login route')
  // Analytics instrumentation is best-effort and must not gate navigation:
  // the pending flag + event emit precede the unconditional assign.
  assert.match(shared, /captureEvent\('github_login_started'[\s\S]*?window\.location\.assign/)
})
