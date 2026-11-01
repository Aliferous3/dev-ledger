import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

// Desktop auth handoff tests — the dlc_/dlt_ credential lifecycle against
// an in-memory PostgREST fake. Proves: codes/tokens are hashed at rest,
// single-use semantics drive an UPDATE guarded by consumed_at IS NULL,
// bearer resolution binds to a live auth_sessions row, and the exchange
// endpoint never lets malformed input reach the database.

process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long'

const { __setSupabaseForTests } = await import('../lib/db.mjs')
const {
  authenticateBearer,
  consumeDesktopCode,
  desktopDeepLink,
  desktopHandoff,
  oauthDesktopHandoffCode,
  recoverCompletedDesktopHandoff,
  isDesktopFlowId,
  issueDesktopToken,
  revokeDesktopToken,
  CODE_TTL_MS,
  TOKEN_TTL_MS,
  DESKTOP_SCHEME,
} = await import('../lib/desktop-auth.mjs')
const { handleDesktopEndpoint: desktopHandler } = await import('../lib/desktop-endpoint.mjs')
const { requireUser } = await import('../lib/require-user.mjs')

/* ── in-memory PostgREST fake (same contract as security-events tests) ── */

function fakeDb(results = {}) {
  const queries = []
  const METHODS = ['select', 'eq', 'neq', 'is', 'in', 'lt', 'lte', 'gt', 'gte',
    'or', 'order', 'limit', 'single', 'maybeSingle', 'insert', 'update', 'upsert', 'delete']
  return {
    queries,
    from(table) {
      const q = { table, ops: [] }
      const self = {}
      for (const m of METHODS) self[m] = (...args) => (q.ops.push({ m, args }), self)
      self.then = (res, rej) => Promise.resolve()
        .then(() => {
          const fn = results[table]
          return typeof fn === 'function' ? fn(q) : (fn ?? { data: null, error: null })
        })
        .then(res, rej)
      queries.push(q)
      return self
    },
  }
}

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    getHeader(k) { return this.headers[k.toLowerCase()] },
    writeHead(c, h) { this.statusCode = c; if (h) Object.assign(this.headers, h); return this },
    end() { return this },
  }
}

const mockReq = (o = {}) => ({ method: 'GET', url: '/api/x', headers: {}, ...o })
const FLOW = '123e4567-e89b-42d3-a456-426614174000'
const USER = 'b10e8f2a-9d77-4c8e-9e6a-2f0a1b2c3d4e'
const SID = 'sid_browser_session_0001'
const VERIFIER = 'v' + 'a'.repeat(47)
const CHALLENGE = 'c'.repeat(64)
const SHA256 = /^[0-9a-f]{64}$/

let db
before(() => { db = fakeDb(); __setSupabaseForTests(db) })
after(() => __setSupabaseForTests(null))

/* ── identifiers + deep link ────────────────────────────────────────── */

test('isDesktopFlowId accepts only a canonical UUID', () => {
  assert.ok(isDesktopFlowId(FLOW))
  assert.ok(isDesktopFlowId(FLOW.toUpperCase()))
  for (const bad of ['', 'x', 'not-a-uuid', FLOW.slice(0, -1), `${FLOW}x`,
    '../etc', `${FLOW}?injected=1`, 42, null, undefined, { toString: () => FLOW }]) {
    assert.equal(isDesktopFlowId(bad), false, JSON.stringify(bad))
  }
})

test('desktopDeepLink emits the registered scheme and no secret material', () => {
  const link = desktopDeepLink(FLOW, 'dlc_abc123')
  assert.ok(link.startsWith(`${DESKTOP_SCHEME}://auth`))
  const u = new URL(link)
  assert.equal(u.protocol, `${DESKTOP_SCHEME}:`)
  assert.equal(u.searchParams.get('flow'), FLOW)
  assert.equal(u.searchParams.get('code'), 'dlc_abc123')
})

/* ── handoff (callback side) ────────────────────────────────────────── */

test('desktopHandoff falls back cleanly when no desktop flow is pending', async () => {
  const res = mockRes()
  const session = { userId: USER, sid: SID, save: async () => {} }
  assert.equal(await desktopHandoff(res, session, '/'), false)
  assert.equal(res.statusCode, 200) // untouched — caller sends the web redirect
})

test('desktopHandoff stores ONLY a hash and 302s to dev-ledger://auth', async () => {
  db = fakeDb({ desktop_auth_codes: { data: [{ code_hash: 'x' }], error: null } })
  __setSupabaseForTests(db)
  const res = mockRes()
  const session = { desktopFlow: FLOW, desktopChallenge: CHALLENGE, userId: USER, sid: SID, save: async () => {} }

  assert.equal(await desktopHandoff(res, session, '/'), true)
  assert.equal(res.statusCode, 302)

  const location = res.headers.Location
  assert.ok(location.startsWith('dev-ledger://auth?'))
  const u = new URL(location)
  assert.equal(u.searchParams.get('flow'), FLOW)
  const code = u.searchParams.get('code')
  assert.match(code, /^dlc_[A-Za-z0-9_-]{32}$/)

  const insert = db.queries
    .find((q) => q.table === 'desktop_auth_codes')
    ?.ops.find((o) => o.m === 'insert')?.args[0]
  assert.ok(insert, 'a code row was inserted')
  assert.match(insert.code_hash, SHA256, 'stored value is a hash')
  assert.notEqual(insert.code_hash, code, 'plaintext code never reaches storage')
  assert.equal(insert.flow, FLOW)
  assert.equal(insert.user_id, USER)
  assert.equal(insert.session_sid, SID)
  assert.equal(insert.challenge, CHALLENGE, 'PKCE challenge binds code to this app instance')
  assert.ok(new Date(insert.expires_at) - Date.now() <= CODE_TTL_MS)
  // The flow marker is consumed — a repeat callback cannot mint a second
  // code off the same sealed session.
  assert.equal(session.desktopFlow, undefined)
  assert.equal(session.desktopChallenge, undefined, 'challenge consumed with the flow')
})

test('desktopHandoff insert failure degrades to the normal web redirect', async () => {
  db = fakeDb({ desktop_auth_codes: { data: null, error: { message: 'insert failed' } } })
  __setSupabaseForTests(db)
  const res = mockRes()
  const session = { desktopFlow: FLOW, userId: USER, sid: SID, save: async () => {} }
  assert.equal(await desktopHandoff(res, session, '/'), true)
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.Location, '/')
})

test('OAuth-derived desktop handoff is stable, PKCE-bound and never a raw GitHub code', async () => {
  const oauthCode = 'sample-code-123'
  const one = oauthDesktopHandoffCode(oauthCode, FLOW, CHALLENGE)
  const two = oauthDesktopHandoffCode(oauthCode, FLOW, CHALLENGE)
  assert.match(one, /^dlc_[A-Za-z0-9_-]{43}$/)
  assert.equal(one, two)
  assert.notEqual(one, oauthCode)
  assert.notEqual(one, oauthDesktopHandoffCode(oauthCode + '-different', FLOW, CHALLENGE))
  assert.notEqual(one, oauthDesktopHandoffCode(oauthCode, FLOW.slice(0, -1) + '1', CHALLENGE))
  assert.notEqual(one, oauthDesktopHandoffCode(oauthCode, FLOW, 'd'.repeat(64)))
  assert.equal(oauthDesktopHandoffCode(oauthCode, FLOW, 'invalid'), null)
  assert.equal(oauthDesktopHandoffCode('', FLOW, CHALLENGE), null)

  db = fakeDb({ desktop_auth_codes: { data: null, error: null } })
  __setSupabaseForTests(db)
  const res = mockRes()
  const session = {
    desktopFlow: FLOW, desktopChallenge: CHALLENGE,
    userId: USER, sid: SID, save: async () => {},
  }
  assert.equal(await desktopHandoff(res, session, '/', oauthCode), true)
  assert.equal(res.statusCode, 302)
  assert.equal(new URL(res.headers.Location).searchParams.get('code'), one)
  const insert = db.queries.find((q) => q.table === 'desktop_auth_codes')
    ?.ops.find((o) => o.m === 'insert')?.args[0]
  assert.equal(insert.code_hash, await import('node:crypto').then(({ default: crypto }) =>
    crypto.createHash('sha256').update(one).digest('hex')))
  assert.notEqual(insert.code_hash, one, 'only a hash reaches the database')
})

test('replayed desktop callback recovers only the already-issued matching handoff', async () => {
  const oauthCode = 'sample-code-123'
  const expected = oauthDesktopHandoffCode(oauthCode, FLOW, CHALLENGE)
  const { default: crypto } = await import('node:crypto')
  const codeHash = crypto.createHash('sha256').update(expected).digest('hex')
  let inserted = false
  db = fakeDb({
    desktop_auth_codes: (q) => {
      if (q.ops.some((o) => o.m === 'insert')) {
        inserted = true
        return { data: null, error: null }
      }
      const filters = q.ops.filter((o) => o.m === 'eq')
      const sameCode = filters.some((o) => o.args[0] === 'code_hash' && o.args[1] === codeHash)
      const sameFlow = filters.some((o) => o.args[0] === 'flow' && o.args[1] === FLOW)
      const samePkce = filters.some((o) => o.args[0] === 'challenge' && o.args[1] === CHALLENGE)
      return {
        data: inserted && sameCode && sameFlow && samePkce ? { code_hash: codeHash } : null,
        error: null,
      }
    },
  })
  __setSupabaseForTests(db)
  const first = mockRes()
  await desktopHandoff(first, {
    desktopFlow: FLOW, desktopChallenge: CHALLENGE,
    userId: USER, sid: SID, save: async () => {},
  }, '/', oauthCode)
  const retry = mockRes()
  assert.equal(await recoverCompletedDesktopHandoff(retry, {
    desktopFlow: FLOW, desktopChallenge: CHALLENGE,
  }, oauthCode, { attempts: 1, delayMs: 0 }), true)
  assert.equal(retry.statusCode, 302)
  assert.equal(retry.headers.Location, first.headers.Location)
  assert.equal(retry.headers['Cache-Control'], 'private, no-store, max-age=0')
  assert.equal(await recoverCompletedDesktopHandoff(mockRes(), {
    desktopFlow: FLOW, desktopChallenge: CHALLENGE,
  }, 'a-different-github-code', { attempts: 1, delayMs: 0 }), false)
  assert.equal(await recoverCompletedDesktopHandoff(mockRes(), {
    desktopFlow: FLOW, desktopChallenge: 'd'.repeat(64),
  }, oauthCode, { attempts: 1, delayMs: 0 }), false)
})

test('GitHub recovery cannot create a handoff on its own', async () => {
  db = fakeDb({ desktop_auth_codes: { data: null, error: null } })
  __setSupabaseForTests(db)
  const response = mockRes()
  const restored = await recoverCompletedDesktopHandoff(response, {
    desktopFlow: FLOW, desktopChallenge: CHALLENGE,
  }, 'not-previously-exchanged', { attempts: 1, delayMs: 0 })
  assert.equal(restored, false)
  assert.equal(response.statusCode, 200)
  assert.equal(db.queries.filter((q) => q.table === 'desktop_auth_codes').length, 1)
  assert.equal(db.queries.some((q) => q.ops.some((o) => o.m === 'insert')), false)
})

/* ── code consume (single-use, expiry, binding) ─────────────────────── */

test('consumeDesktopCode rejects malformed input without touching the DB', async () => {
  db = fakeDb()
  __setSupabaseForTests(db)
  for (const [c, f] of [
    ['bad-code', FLOW],
    ['dlc_', FLOW],
    ['dlc_' + 'a'.repeat(40), 'not-a-flow'],
    ['', FLOW],
    [null, FLOW],
    ['dlc_' + 'a'.repeat(40), FLOW + '?x=1'],
  ]) {
    assert.equal(await consumeDesktopCode(c, f, VERIFIER), null)
  }
  // Malformed verifiers likewise never reach the database.
  for (const v of ['', 'short', 'with spaces and bad!!chars', null, undefined]) {
    assert.equal(await consumeDesktopCode('dlc_' + 'a'.repeat(40), FLOW, v), null)
  }
  assert.equal(db.queries.length, 0, 'no query was issued')
})

test('consumeDesktopCode drives the atomic guarded UPDATE', async () => {
  db = fakeDb({ desktop_auth_codes: { data: [{ user_id: USER, session_sid: SID }] } })
  __setSupabaseForTests(db)
  const code = 'dlc_' + 'a'.repeat(40)
  const r = await consumeDesktopCode(code, FLOW, VERIFIER)
  assert.deepEqual(r, { userId: USER, sessionSid: SID })

  const q = db.queries.find((x) => x.table === 'desktop_auth_codes')
  const ops = Object.fromEntries(q.ops.map((o) => [o.m, o.args]))
  assert.deepEqual(ops.update?.[0] && Object.keys(ops.update[0]), ['consumed_at'])
  // consumed_at IS NULL + expires_at > now guards make the UPDATE atomic:
  // concurrent exchanges can never both succeed on one code.
  assert.ok(q.ops.some((o) => o.m === 'is' && o.args[0] === 'consumed_at' && o.args[1] === null))
  assert.ok(q.ops.some((o) => o.m === 'gt' && o.args[0] === 'expires_at'))
  const eqHash = q.ops.find((o) => o.m === 'eq' && o.args[0] === 'code_hash')
  assert.match(eqHash.args[1], SHA256, 'lookup is by hash, never plaintext')
  const eqFlow = q.ops.find((o) => o.m === 'eq' && o.args[0] === 'flow')
  assert.equal(eqFlow.args[1], FLOW)
  // The verifier hashes into the SAME guarded UPDATE — a stolen deep link
  // (flow+code) without the verifier can never match a row.
  const eqCh = q.ops.find((o) => o.m === 'eq' && o.args[0] === 'challenge')
  assert.match(eqCh.args[1], SHA256, 'challenge lookup is by sha256(verifier)')
  assert.notEqual(eqCh.args[1], VERIFIER)
})

test('consumeDesktopCode: expired/consumed/wrong-flow all return null', async () => {
  // All of these collapse to "no rows returned" — same outcome Postgres
  // produces for expired, already-consumed, or flow-mismatched codes.
  db = fakeDb({ desktop_auth_codes: { data: [] } })
  __setSupabaseForTests(db)
  assert.equal(await consumeDesktopCode('dlc_' + 'a'.repeat(40), FLOW, VERIFIER), null)
})

/* ── token issue + bearer resolution ────────────────────────────────── */

test('issueDesktopToken returns plaintext once and stores only the hash', async () => {
  db = fakeDb({ desktop_tokens: { data: [{ token_hash: 'x' }], error: null } })
  __setSupabaseForTests(db)
  const token = await issueDesktopToken(USER, 'sid_desktop_0002')
  assert.match(token, /^dlt_[A-Za-z0-9_-]{43}$/)
  const insert = db.queries
    .find((q) => q.table === 'desktop_tokens')
    ?.ops.find((o) => o.m === 'insert')?.args[0]
  assert.match(insert.token_hash, SHA256)
  assert.notEqual(insert.token_hash, token)
  assert.equal(insert.user_id, USER)
  assert.equal(insert.session_sid, 'sid_desktop_0002')
  assert.ok(new Date(insert.expires_at) - Date.now() <= TOKEN_TTL_MS)
})

test('authenticateBearer: missing/malformed headers never hit the DB', async () => {
  db = fakeDb()
  __setSupabaseForTests(db)
  for (const h of [undefined, '', 'Bearer', 'Bearer x', 'Basic dlt_abc', 'bearer dlt_abc']) {
    assert.equal(await authenticateBearer(mockReq({ headers: { authorization: h } })), null)
  }
  // A dlt_-shaped string that fails the regex is also rejected pre-DB.
  assert.equal(await authenticateBearer(mockReq({ headers: { authorization: 'Bearer dlt_short' } })), null)
  assert.equal(db.queries.length, 0)
})

test('authenticateBearer resolves a live token + live session to a principal', async () => {
  const sid = 'sid_desktop_live'
  db = fakeDb({
    desktop_tokens: { data: { user_id: USER, session_sid: sid } },
    auth_sessions: { data: { sid } },
  })
  __setSupabaseForTests(db)
  const token = 'dlt_' + 'a'.repeat(43)
  const p = await authenticateBearer(mockReq({ headers: { authorization: `Bearer ${token}` } }))
  assert.deepEqual({ userId: p.userId, sid: p.sid }, { userId: USER, sid })

  const tq = db.queries.find((q) => q.table === 'desktop_tokens')
  const eq = tq.ops.find((o) => o.m === 'eq' && o.args[0] === 'token_hash')
  assert.match(eq.args[1], SHA256, 'lookup hashes the presented token')
  assert.ok(tq.ops.some((o) => o.m === 'gt' && o.args[0] === 'expires_at'), 'expiry filtered')

  // The bound auth_sessions row was liveness-checked — revocation kills
  // the token exactly like a browser session.
  const sq = db.queries.find((q) => q.table === 'auth_sessions')
  assert.ok(sq.ops.some((o) => o.m === 'eq' && o.args[0] === 'sid' && o.args[1] === sid))
})

test('authenticateBearer: dead bound session ⇒ principal rejected', async () => {
  db = fakeDb({
    desktop_tokens: { data: { user_id: USER, session_sid: 'dead_sid' } },
    auth_sessions: { data: null }, // deleted/revoked/expired — indistinguishable
  })
  __setSupabaseForTests(db)
  const token = 'dlt_' + 'a'.repeat(43)
  assert.equal(await authenticateBearer(mockReq({ headers: { authorization: `Bearer ${token}` } })), null)
})

test('revokeDesktopToken deletes the token row AND its bound session', async () => {
  db = fakeDb()
  __setSupabaseForTests(db)
  await revokeDesktopToken('a'.repeat(64), 'sid_to_kill')
  const tables = db.queries.map((q) => q.table)
  assert.deepEqual(tables.sort(), ['auth_sessions', 'desktop_tokens'])
  for (const q of db.queries) {
    assert.ok(q.ops.some((o) => o.m === 'delete'), `${q.table} used delete`)
  }
})

/* ── /api/auth/desktop endpoint ─────────────────────────────────────── */

test('exchange rejects malformed flow/code shapes with 400 and no DB write', async () => {
  db = fakeDb()
  __setSupabaseForTests(db)
  for (const body of [{}, { flow: FLOW }, { code: 'dlc_x', verifier: VERIFIER },
    { flow: 'nope', code: 'dlc_x', verifier: VERIFIER },
    { flow: FLOW, code: 'dlc_x' }, // no verifier — the PKCE half is mandatory
    { flow: FLOW, code: 'dlc_x', verifier: 'short' }]) {
    const res = mockRes()
    await desktopHandler(mockReq({ method: 'POST', url: '/api/auth/desktop?op=exchange', body }), res)
    assert.equal(res.statusCode, 400, JSON.stringify(body))
  }
  assert.equal(db.queries.length, 0)
})

test('exchange: rejected/expired/already-used code ⇒ 400, no token issued', async () => {
  db = fakeDb({ desktop_auth_codes: { data: [] } })
  __setSupabaseForTests(db)
  const res = mockRes()
  await desktopHandler(mockReq({
    method: 'POST',
    url: '/api/auth/desktop?op=exchange',
    body: { flow: FLOW, code: 'dlc_' + 'a'.repeat(40), verifier: VERIFIER },
  }), res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.token, undefined)
  assert.equal(db.queries.some((q) => q.table === 'desktop_tokens'), false)
})

test('exchange: code bound to a dead session ⇒ 400, no token issued', async () => {
  db = fakeDb({
    desktop_auth_codes: { data: [{ user_id: USER, session_sid: SID }] },
    auth_sessions: { data: null }, // browser session died before exchange
  })
  __setSupabaseForTests(db)
  const res = mockRes()
  await desktopHandler(mockReq({
    method: 'POST',
    url: '/api/auth/desktop?op=exchange',
    body: { flow: FLOW, code: 'dlc_' + 'a'.repeat(40), verifier: VERIFIER },
  }), res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.token, undefined)
})

test('exchange: happy path mints a dedicated session + bearer token', async () => {
  db = fakeDb({
    desktop_auth_codes: { data: [{ user_id: USER, session_sid: SID }] },
    auth_sessions: (q) => q.ops.some((o) => o.m === 'select')
      ? { data: { sid: SID } }                 // isSessionLive(consumed.sessionSid)
      : { data: [{ sid: 'new' }], error: null }, // createAuthSession insert
    desktop_tokens: { data: [{ token_hash: 'x' }], error: null },
    users: { data: { github_login: 'octo', avatar_url: 'https://x/a.png', display_name: 'Octo' } },
  })
  __setSupabaseForTests(db)
  const res = mockRes()
  await desktopHandler(mockReq({
    method: 'POST',
    url: '/api/auth/desktop?op=exchange',
    body: { flow: FLOW, code: 'dlc_' + 'a'.repeat(40), verifier: VERIFIER },
  }), res)
  assert.equal(res.statusCode, 200)
  assert.match(res.body.token, /^dlt_[A-Za-z0-9_-]{43}$/)
  assert.equal(res.body.user.githubLogin, 'octo')

  // The new desktop session is created persistent — the bearer token IS
  // the long-lived credential; no inactivity lease applies.
  const sessInsert = db.queries
    .filter((q) => q.table === 'auth_sessions')
    .flatMap((q) => q.ops.filter((o) => o.m === 'insert'))[0]?.args[0]
  assert.equal(sessInsert.persistent, true)
  assert.equal(sessInsert.user_id, USER)
})

test('desktop logout requires a valid bearer token and revokes token+session', async () => {
  db = fakeDb({
    desktop_tokens: { data: { user_id: USER, session_sid: 'sid_d' } },
    auth_sessions: { data: { sid: 'sid_d' } },
  })
  __setSupabaseForTests(db)

  // No bearer → 401
  let res = mockRes()
  await desktopHandler(mockReq({ method: 'POST', url: '/api/auth/desktop?op=logout' }), res)
  assert.equal(res.statusCode, 401)

  // Valid bearer → 200 and both rows deleted
  db.queries.length = 0
  res = mockRes()
  const token = 'dlt_' + 'a'.repeat(43)
  await desktopHandler(mockReq({
    method: 'POST',
    url: '/api/auth/desktop?op=logout',
    headers: { authorization: `Bearer ${token}` },
  }), res)
  assert.equal(res.statusCode, 200)
  const tables = db.queries.filter((q) => q.ops.some((o) => o.m === 'delete')).map((q) => q.table)
  assert.deepEqual(tables.sort(), ['auth_sessions', 'desktop_tokens'])
})

test('unknown actions and GET are rejected', async () => {
  db = fakeDb()
  __setSupabaseForTests(db)
  let res = mockRes()
  await desktopHandler(mockReq({ method: 'GET', url: '/api/auth/desktop?op=exchange' }), res)
  assert.equal(res.statusCode, 405)
  res = mockRes()
  await desktopHandler(mockReq({ method: 'POST', url: '/api/auth/desktop?op=nope' }), res)
  assert.equal(res.statusCode, 400)
})

/* ── requireUser bearer path ────────────────────────────────────────── */

test('requireUser resolves a valid bearer token to the user id', async () => {
  db = fakeDb({
    desktop_tokens: { data: { user_id: USER, session_sid: 'sid_d' } },
    auth_sessions: { data: { sid: 'sid_d' } },
  })
  __setSupabaseForTests(db)
  const token = 'dlt_' + 'a'.repeat(43)
  const res = mockRes()
  const uid = await requireUser(mockReq({ headers: { authorization: `Bearer ${token}` } }), res)
  assert.equal(uid, USER)
  assert.equal(res.statusCode, 200, 'no response was sent — caller proceeds')
})

test('requireUser rejects an invalid bearer token (401) without falling to cookie trust', async () => {
  db = fakeDb({ desktop_tokens: { data: null } })
  __setSupabaseForTests(db)
  const token = 'dlt_' + 'a'.repeat(43)
  const res = mockRes()
  const uid = await requireUser(mockReq({ headers: { authorization: `Bearer ${token}` } }), res)
  assert.equal(uid, null)
  assert.equal(res.statusCode, 401)
})
